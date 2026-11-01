import { MESES, DIAS_SEMANA, chaveDia, diasDoMes, somaMacros } from './datas.js';
import * as db from './db.js';

const HOJE = new Date();
const ANO = HOJE.getFullYear();
const CHAVE_HOJE = chaveDia(HOJE);
const REFEICOES_PADRAO = ['Café da manhã', 'Almoço', 'Lanche', 'Jantar'];

// ---- estado em memória, espelho do que está no banco ----
let perfil = { id: 'eu', nome: '', peso: null, altura: null, foto: null };
let fichas = [];
let diasTreino = new Set();
let diaHoje = { data: CHAVE_HOJE, refeicoes: [], agua: 0 };
let sessao = null;
let recordes = {};   // exercício -> { kg, reps, data }
let salvas = [];     // refeições salvas para repetir
let diasDieta = {};  // data -> kcal somadas
let gradeDe = 'treino';
let catalogo = [];   // dados/exercicios.json
let alimentos = [];  // dados/taco.json + os criados pelo usuário

let telaAtual = 'hoje';
let diaSelecionado = null;
let mesAberto = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const nz = (v) => (v == null ? 0 : v); // TACO usa null para "não analisado"

// =========================================================================
// Carga inicial
// =========================================================================

async function carregar() {
  [perfil, fichas, diasTreino, diaHoje, recordes, salvas, diasDieta] = await Promise.all([
    db.perfil(), db.todos(db.LOJAS.fichas), db.diasComTreino(), db.dia(CHAVE_HOJE),
    db.recordes(), db.todos(db.LOJAS.salvas), db.diasComDieta(),
  ]);
  // As quatro refeições do dia já vêm postas; o usuário acrescenta outras se quiser.
  if (!diaHoje.refeicoes.length) diaHoje.refeicoes = REFEICOES_PADRAO.map((nome) => ({ nome, itens: [] }));
  const cor = await db.config('cor');
  if (cor) document.documentElement.style.setProperty('--cor', cor);
  renderTudo();
  carregarCatalogos();
}

async function carregarCatalogos() {
  const [ex, taco, meus] = await Promise.all([
    fetch('dados/exercicios.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch('dados/taco.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    db.todos(db.LOJAS.alimentos).catch(() => []),
  ]);
  catalogo = ex;
  alimentos = [
    ...meus,
    ...taco.map((a) => ({
      id: a.id, nome: a.nome,
      kcal: nz(a.por100g?.kcal), p: nz(a.por100g?.proteina),
      c: nz(a.por100g?.carboidrato), g: nz(a.por100g?.gordura),
    })),
  ];
}

// =========================================================================
// Hoje
// =========================================================================

function macrosDoDia() {
  return somaMacros(diaHoje.refeicoes.flatMap((r) => r.itens.map((i) => ({ kcal: i.kcal, p: i.p, c: i.c, g: i.g }))));
}

function renderHoje() {
  const sessoes = [...diasTreino].includes(CHAVE_HOJE);
  const m = macrosDoDia();
  const temComida = diaHoje.refeicoes.some((r) => r.itens.length);
  const dataLonga = HOJE.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  $('#tela-hoje').innerHTML = `
    <header class="topo">
      <h1>Hoje</h1>
      <div class="data">${esc(dataLonga)}</div>
    </header>

    <div class="card">
      <h2>Treino</h2>
      ${sessoes
        ? `<div class="linha-item"><div>Treino registrado</div><div class="destaque">✓</div></div>`
        : `<div class="vazio">Nada registrado hoje.</div>
           <button class="botao" data-ir="treino">Registrar treino</button>`}
    </div>

    <div class="card">
      <h2>Dieta</h2>
      ${temComida
        ? `<div class="linha-item"><div>Calorias</div><div class="destaque">${m.kcal.toFixed(0)} kcal</div></div>
           <div class="linha-item"><div class="sub">Proteína ${n1(m.p)} g · Carboidrato ${n1(m.c)} g · Gordura ${n1(m.g)} g</div></div>`
        : `<div class="vazio">Nada registrado hoje.</div>
           <button class="botao" data-ir="dieta">Registrar refeição</button>`}
    </div>

    <div class="card">
      <h2>Este mês</h2>
      <div class="linha-item">
        <div><div class="num-grande ${contaMes(HOJE.getMonth()) ? 'destaque' : ''}">${contaMes(HOJE.getMonth())}</div>
          <div class="sub" style="margin-top:6px">dias treinados em ${MESES[HOJE.getMonth()].toLowerCase()}</div></div>
      </div>
    </div>`;
}

// =========================================================================
// Treino
// =========================================================================

function renderTreino() {
  const el = $('#tela-treino');

  if (sessao) {
    const todas = sessao.exercicios.flatMap((e) => e.series);
    const feitas = todas.filter((s) => s.feita).length;
    el.innerHTML = `
      <header class="topo">
        <h1>${esc(sessao.nome)}</h1>
        <div class="data">${feitas} de ${todas.length} séries</div>
      </header>
      ${sessao.exercicios.map((ex, ie) => cartaoExercicio(ex, ie)).join('')}
      <button class="botao fraco" id="addExercicio">Adicionar exercício</button>
      <button class="botao" id="finalizar">Finalizar treino</button>
      <button class="botao fraco" id="cancelar">Cancelar</button>`;
    return;
  }

  el.innerHTML = `
    <header class="topo"><h1>Treino</h1>
      <div class="data">${fichas.length ? 'Escolha uma ficha' : 'Nenhuma ficha ainda'}</div></header>
    ${fichas.length
      ? fichas.map((f) => `
        <button class="card" style="display:block;width:100%;text-align:left" data-ficha="${esc(f.id)}">
          <div class="linha-item">
            <div><div style="font-weight:600">${esc(f.nome)}</div>
              <div class="sub">${f.exercicios.length} exercício${f.exercicios.length === 1 ? '' : 's'}</div></div>
            <div class="sub">›</div>
          </div>
        </button>`).join('')
      : `<div class="card"><div class="vazio">Monte uma ficha para começar a registrar seus treinos.</div></div>`}
    <button class="botao ${fichas.length ? 'fraco' : ''}" id="novaFicha">Nova ficha</button>
    <button class="botao fraco" id="abrirCardio">Registrar cardio</button>`;
}

function folhaAddExercicio() {
  abrirFolha(`<h3>Adicionar exercício</h3>
    <input class="busca" id="axBusca" placeholder="Buscar exercício" autocomplete="off">
    <div id="axResultados"></div>`);
  const lista = () => {
    const q = $('#axBusca').value.trim();
    const ql = q.toLowerCase();
    const achados = (ql ? catalogo.filter((e) => e.nome.toLowerCase().includes(ql)) : catalogo).slice(0, 8);
    $('#axResultados').innerHTML = achados.length
      ? achados.map((e) => `<button class="opcao" data-ax="${esc(e.nome)}">
          <div><div>${esc(e.nome)}</div><div class="sub">${esc(e.grupo)} · ${esc(e.equipamento)}</div></div></button>`).join('')
      : `<div class="vazio">Nada encontrado.${q ? ` <button class="destaque" data-ax="${esc(q)}">Usar "${esc(q)}"</button>` : ''}</div>`;
  };
  lista();
  $('#axBusca').addEventListener('input', lista);
}

/**
 * No modo cluster a carga é uma só para o exercício inteiro: os blocos mudam
 * as repetições, não o peso. Por isso o campo de kg sai das linhas e sobe
 * para o topo do cartão.
 */
function cartaoExercicio(ex, ie) {
  const rec = recordes[ex.nome];
  const cluster = ex.modo === 'cluster';
  const bateuPr = (s) => s.feita && s.kg != null && (!rec || s.kg > rec.kg);

  const linhas = ex.series.map((s, is) => `
    <div class="serie ${cluster ? 'cluster' : ''} ${s.feita ? 'feita' : ''}">
      <span class="idx">${cluster ? 'bloco ' + (is + 1) : is + 1}</span>
      ${cluster ? '' : `<input type="number" inputmode="decimal" value="${s.kg ?? ''}" data-campo="kg" data-e="${ie}" data-s="${is}">`}
      <input type="number" inputmode="numeric" value="${s.reps ?? ''}" data-campo="reps" data-e="${ie}" data-s="${is}">
      <button class="ok" data-feita="${ie}:${is}">${bateuPr(s) ? 'PR' : '✓'}</button>
    </div>`).join('');

  return `<div class="card">
    <div class="ex-cab">
      <h2>${esc(ex.nome)}</h2>
      <button class="chip" data-modo="${ie}">${cluster ? 'cluster' : 'linear'}</button>
      <button class="chip apagar" data-tirar-ex="${ie}" aria-label="Remover exercício">✕</button>
    </div>
    ${rec ? `<div class="sub">recorde ${n1(rec.kg)} kg${rec.reps ? ' × ' + rec.reps : ''}</div>` : ''}
    ${cluster
      ? `<div class="serie-cab cluster"><span></span><span>reps</span><span></span></div>
         <label class="rot" for="kgc-${ie}">Carga do exercício (kg)</label>
         <input class="busca" id="kgc-${ie}" type="number" inputmode="decimal" value="${ex.series[0]?.kg ?? ''}" data-campo="kgCluster" data-e="${ie}">`
      : '<div class="serie-cab"><span></span><span>kg</span><span>reps</span><span></span></div>'}
    ${linhas}
    <div class="ex-pe">
      <button class="chip" data-menos-serie="${ie}">− série</button>
      <button class="chip" data-mais-serie="${ie}">+ série</button>
    </div>
  </div>`;
}

async function abrirSessao(fichaId) {
  const f = fichas.find((x) => x.id === fichaId);
  if (!f) return;
  const anteriores = await db.cargasAnteriores(fichaId);
  sessao = {
    fichaId, nome: f.nome,
    exercicios: f.exercicios.map((e) => {
      const ant = anteriores[e.nome];
      return {
        nome: e.nome,
        modo: e.modo || 'linear',
        series: Array.from({ length: e.series || 3 }, () => ({
          kg: ant ? ant.kg : null, reps: ant ? ant.reps : null, feita: false,
        })),
      };
    }),
  };
  setTela('treino');
}

/** Como a ficha ficaria se as mudanças desta sessão fossem salvas nela. */
function fichaDaSessao() {
  return sessao.exercicios.map((e) => ({ nome: e.nome, series: e.series.length, modo: e.modo }));
}

function fichaMudou() {
  const f = fichas.find((x) => x.id === sessao.fichaId);
  if (!f) return false;
  const antes = f.exercicios.map((e) => `${e.nome}|${e.series || 3}|${e.modo || 'linear'}`).join('~');
  const agora = fichaDaSessao().map((e) => `${e.nome}|${e.series}|${e.modo}`).join('~');
  return antes !== agora;
}

function pedirFinalizar() {
  const feitas = sessao.exercicios.flatMap((e) => e.series).filter((s) => s.feita).length;
  if (!feitas) { alerta('Marque pelo menos uma série antes de finalizar.'); return; }

  if (!fichaMudou()) return finalizarSessao(false);

  abrirFolha(`<h3>Você mudou a ficha durante o treino</h3>
    <div class="sub" style="margin-bottom:16px">Salvar essas mudanças em "${esc(sessao.nome)}" para as próximas vezes?</div>
    <button class="botao" id="salvarNaFicha">Salvar na ficha</button>
    <button class="botao fraco" id="soHoje">Só para hoje</button>`);
}

async function finalizarSessao(salvarNaFicha) {
  const exercicios = sessao.exercicios.map((e) => ({
    nome: e.nome, modo: e.modo,
    series: e.series.filter((s) => s.feita).map((s) => ({ kg: s.kg, reps: s.reps })),
  })).filter((e) => e.series.length);

  await db.gravar(db.LOJAS.sessoes, {
    data: CHAVE_HOJE, tipo: 'musculacao', fichaId: sessao.fichaId, nome: sessao.nome,
    exercicios, em: new Date().toISOString(),
  });

  if (salvarNaFicha) {
    const f = fichas.find((x) => x.id === sessao.fichaId);
    if (f) await db.gravar(db.LOJAS.fichas, { ...f, exercicios: fichaDaSessao() });
  }

  [diasTreino, recordes, fichas] = await Promise.all([
    db.diasComTreino(), db.recordes(), db.todos(db.LOJAS.fichas),
  ]);
  sessao = null;
  fecharFolha();
  setTela('perfil');
}

function folhaCardio() {
  const tipos = catalogo.filter((e) => e.tipo === 'cardio');
  abrirFolha(`<h3>Registrar cardio</h3>
    <label class="rot" for="cTipo">O quê</label>
    <select class="busca" id="cTipo">
      ${tipos.map((t) => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('')}
    </select>
    <label class="rot" for="cMin">Tempo (minutos)</label>
    <input class="busca" id="cMin" type="number" inputmode="numeric" placeholder="30">
    <button class="botao" id="salvarCardio">Registrar</button>`);
}

async function salvarCardio() {
  const atividade = $('#cTipo').value;
  const minutos = Number($('#cMin').value) || 0;
  if (!atividade || minutos <= 0) return;
  await db.gravar(db.LOJAS.sessoes, {
    data: CHAVE_HOJE, tipo: 'cardio', nome: atividade, minutos,
    exercicios: [], em: new Date().toISOString(),
  });
  diasTreino = await db.diasComTreino();
  fecharFolha();
  setTela('perfil');
}

// =========================================================================
// Dieta
// =========================================================================

function renderDieta() {
  const m = macrosDoDia();
  const refs = diaHoje.refeicoes;
  $('#tela-dieta').innerHTML = `
    <header class="topo"><h1>Dieta</h1><div class="data">Hoje</div></header>

    <div class="card">
      <div class="linha-item">
        <div><div class="num-grande ${m.kcal ? 'destaque' : ''}">${m.kcal.toFixed(0)}</div>
          <div class="sub" style="margin-top:6px">kcal somadas hoje</div></div>
      </div>
      ${m.kcal ? `<div class="linha-item"><div class="sub">P ${n1(m.p)} g · C ${n1(m.c)} g · G ${n1(m.g)} g</div></div>` : ''}
    </div>

    ${refs.length
      ? refs.map((r, i) => {
        const s = somaMacros(r.itens);
        return `<div class="card">
          <h2>${esc(r.nome)}</h2>
          ${r.itens.length
            ? r.itens.map((it, j) => `<div class="linha-item">
                <div><div>${esc(it.nome)}</div><div class="sub">${n1(it.g_)} g</div></div>
                <button class="sub" data-remover="${i}:${j}">${it.kcal.toFixed(0)} kcal ✕</button></div>`).join('')
            : '<div class="vazio">Nada registrado.</div>'}
          <div class="ex-pe">
            <button class="chip" data-add-refeicao="${i}">+ alimento</button>
            ${salvas.length ? `<button class="chip" data-repetir="${i}">repetir salva</button>` : ''}
            ${r.itens.length ? `<button class="chip" data-salvar-ref="${i}">salvar</button>` : ''}
          </div>
          ${r.itens.length ? `<div class="sub" style="margin-top:8px">${s.kcal.toFixed(0)} kcal · P ${s.p.toFixed(0)} C ${s.c.toFixed(0)} G ${s.g.toFixed(0)}</div>` : ''}
        </div>`;
      }).join('')
      : '<div class="card"><div class="vazio">Nenhuma refeição hoje.</div></div>'}

    <div class="card">
      <h2>Água</h2>
      <div class="linha-item">
        <div><div class="num-grande ${diaHoje.agua ? 'destaque' : ''}">${(diaHoje.agua / 1000).toFixed(1).replace('.', ',')}</div>
          <div class="sub" style="margin-top:6px">litros hoje</div></div>
        <div class="ex-pe" style="margin:0">
          <button class="chip" data-agua="-250">−</button>
          <button class="chip" data-agua="250">+ copo</button>
          <button class="chip" data-agua="500">+ garrafa</button>
        </div>
      </div>
    </div>

    <button class="botao fraco" id="novaRefeicao">Adicionar refeição</button>`;
}

async function salvarDiaHoje() {
  await db.salvarDia(diaHoje);
  diasDieta = await db.diasComDieta();
  renderTudo();
}

function folhaRepetirSalva(iRef) {
  abrirFolha(`<h3>Repetir uma refeição salva</h3>
    ${salvas.map((s) => {
      const t = somaMacros(s.itens);
      return `<button class="opcao" data-usar-salva="${iRef}:${s.id}">
        <div><div>${esc(s.nome)}</div>
          <div class="sub">${s.itens.length} item${s.itens.length === 1 ? '' : 's'} · ${t.kcal.toFixed(0)} kcal</div></div></button>`;
    }).join('')}`);
}

function folhaSalvarRefeicao(iRef) {
  const r = diaHoje.refeicoes[iRef];
  abrirFolha(`<h3>Salvar para repetir</h3>
    <div class="sub" style="margin-bottom:12px">${r.itens.length} itens de ${esc(r.nome)}.</div>
    <label class="rot" for="sNome">Nome</label>
    <input class="busca" id="sNome" value="${esc(r.nome)}" autocomplete="off">
    <button class="botao" data-confirma-salvar="${iRef}">Salvar</button>`);
}

// =========================================================================
// Perfil
// =========================================================================

/** A grade do perfil mostra treino ou dieta, conforme o botão de cima. */
function diasDaGrade() {
  return gradeDe === 'dieta' ? new Set(Object.keys(diasDieta)) : diasTreino;
}

function renderPerfil() {
  const total = [...diasDaGrade()].filter((k) => k.startsWith(ANO)).length;
  const cores = ['#e5342b', '#ff7a1a', '#f5c518', '#28c76f', '#2f9bff', '#a855f7'];
  const atual = getComputedStyle(document.documentElement).getPropertyValue('--cor').trim();

  $('#tela-perfil').innerHTML = `
    <div class="perfil-topo">
      <button class="avatar" id="abrirPerfil" aria-label="Editar perfil">
        ${perfil.foto ? `<img src="${esc(perfil.foto)}" alt="">` : '<span>+</span>'}
      </button>
      <button id="abrirPerfilTexto" style="text-align:left">
        <div class="nome">${esc(perfil.nome) || 'Seu nome'}</div>
        <div class="sub">${perfil.peso ? n1(perfil.peso) + ' kg' : 'toque para preencher'}${perfil.altura ? ' · ' + perfil.altura + ' cm' : ''}</div>
      </button>
      <div class="cores">${cores.map((c) => `
        <button data-cor="${c}" style="background:${c}" class="${c === atual ? 'sel' : ''}" aria-label="Cor"></button>`).join('')}</div>
    </div>

    <div class="card">
      <div class="ano-cabeca">
        <span class="ano">${ANO} ›</span>
        <span><span class="num-grande ${total ? 'destaque' : ''}">${total}</span> <span class="sub">dias</span></span>
      </div>
      <div class="ex-pe" style="margin:0 0 14px">
        <button class="chip ${gradeDe === 'treino' ? 'sel' : ''}" data-grade="treino">Treino</button>
        <button class="chip ${gradeDe === 'dieta' ? 'sel' : ''}" data-grade="dieta">Dieta</button>
      </div>
      <div class="meses">${MESES.map((_, i) => mesMini(i)).join('')}</div>
    </div>

    ${total ? '' : `<div class="card"><div class="vazio">A grade acende conforme você registra ${gradeDe === 'dieta' ? 'refeições' : 'treinos'}.</div></div>`}`;
}

function contaMes(mes) {
  const pre = `${ANO}-${String(mes + 1).padStart(2, '0')}`;
  return [...diasDaGrade()].filter((k) => k.startsWith(pre)).length;
}

function mesMini(mes) {
  const { vazios, total } = diasDoMes(ANO, mes);
  const futuro = mes > HOJE.getMonth();
  const dias = diasDaGrade();
  let q = '<span class="d off"></span>'.repeat(vazios);
  for (let d = 1; d <= total; d++) {
    const k = `${ANO}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    q += `<span class="${['d', dias.has(k) ? 'on' : '', k === CHAVE_HOJE ? 'hoje' : ''].filter(Boolean).join(' ')}"></span>`;
  }
  return `<button class="mes ${mes === HOJE.getMonth() ? 'atual' : ''} ${futuro ? 'futuro' : ''}" data-mes="${mes}">
    <div class="nome"><span>${MESES[mes].slice(0, 3)}</span><span>${contaMes(mes) || ''}</span></div>
    <div class="dias">${q}</div></button>`;
}

// =========================================================================
// Mês ampliado
// =========================================================================

function abrirMes(mes) { mesAberto = mes; diaSelecionado = null; renderMesAmpliado(); $('#mesAmpliado').classList.add('aberto'); }

function renderMesAmpliado() {
  const mes = mesAberto;
  const { vazios, total } = diasDoMes(ANO, mes);
  const dias = diasDaGrade();
  let cel = '<button class="espaco"></button>'.repeat(vazios);
  for (let d = 1; d <= total; d++) {
    const k = `${ANO}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = [dias.has(k) ? 'on' : '', k === CHAVE_HOJE ? 'hoje' : '', k === diaSelecionado ? 'sel' : ''].filter(Boolean).join(' ');
    cel += `<button class="${cls}" data-dia="${k}">${d}</button>`;
  }
  $('#mesAmpliado').innerHTML = `
    <div class="amp-topo">
      <button class="voltar" id="fecharMes">‹</button>
      <h2>${MESES[mes]} de ${ANO}</h2>
      <span class="sub" style="margin-left:auto">${contaMes(mes)} dias</span>
    </div>
    <div class="semana">${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal">${cel}</div>
    <div class="card" style="margin-top:20px" id="detalheDia"><div class="vazio">Toque num dia para ver o que foi registrado.</div></div>`;
  if (diaSelecionado) mostrarDia(diaSelecionado);
}

async function mostrarDia(k) {
  const [sessoes, d] = await Promise.all([db.sessoesDoDia(k), db.dia(k)]);
  const m = somaMacros(d.refeicoes.flatMap((r) => r.itens));
  const [, mm, dd] = k.split('-');
  const alvo = $('#detalheDia');
  if (!alvo) return;
  alvo.innerHTML = `<h2>${dd} de ${MESES[+mm - 1].toLowerCase()}</h2>
    ${sessoes.length
      ? sessoes.map((s) => `<div class="linha-item"><div><div>${esc(s.nome)}</div>
          <div class="sub">${s.tipo === 'cardio' ? s.minutos + ' min' : s.exercicios.length + ' exercício' + (s.exercicios.length === 1 ? '' : 's')}</div></div>
          <div class="destaque">✓</div></div>`).join('')
      : '<div class="linha-item"><div class="sub">Sem treino.</div></div>'}
    ${m.kcal
      ? `<div class="linha-item"><div>Dieta</div><div class="sub">${m.kcal.toFixed(0)} kcal</div></div>`
      : '<div class="linha-item"><div class="sub">Sem refeições.</div></div>'}`;
}

// =========================================================================
// Folha deslizante
// =========================================================================

function abrirFolha(html) {
  $('#folhaConteudo').innerHTML = html;
  $('#folhaFundo').classList.add('aberta');
  requestAnimationFrame(() => $('#folha').classList.add('aberta'));
}
function fecharFolha() {
  $('#folha').classList.remove('aberta');
  $('#folhaFundo').classList.remove('aberta');
}
function alerta(txt) {
  abrirFolha(`<h3>${esc(txt)}</h3><button class="botao" id="fecharAviso">Entendi</button>`);
}

function folhaRegistro() {
  abrirFolha(`<h3>Registrar</h3>
    <button class="opcao" data-reg="treino"><span class="bolha">🏋️</span><div><div>Treino</div><div class="sub">${fichas.length ? 'Abrir uma ficha' : 'Montar a primeira ficha'}</div></div></button>
    <button class="opcao" data-reg="refeicao"><span class="bolha">🍽️</span><div><div>Refeição</div><div class="sub">Adicionar alimento</div></div></button>
    <button class="opcao" data-reg="perfil"><span class="bolha">👤</span><div><div>Perfil</div><div class="sub">${perfil.peso ? n1(perfil.peso) + ' kg' : 'Preencher'}</div></div></button>`);
}

function folhaPerfil() {
  abrirFolha(`<h3>Seu perfil</h3>
    <div class="campo-foto">
      <div class="avatar grande">${perfil.foto ? `<img src="${esc(perfil.foto)}" alt="">` : '<span>+</span>'}</div>
      <label class="botao fraco" for="arqFoto" style="margin:0">Escolher foto</label>
      <input type="file" id="arqFoto" accept="image/*" hidden>
    </div>
    <label class="rot" for="pNome">Nome</label>
    <input class="busca" id="pNome" value="${esc(perfil.nome)}" autocomplete="off">
    <label class="rot" for="pPeso">Peso (kg)</label>
    <input class="busca" id="pPeso" type="number" inputmode="decimal" value="${perfil.peso ?? ''}">
    <label class="rot" for="pAltura">Altura (cm)</label>
    <input class="busca" id="pAltura" type="number" inputmode="numeric" value="${perfil.altura ?? ''}">
    <button class="botao" id="salvarPerfil">Salvar</button>`);
}

function folhaNovaFicha() {
  abrirFolha(`<h3>Nova ficha</h3>
    <label class="rot" for="fNome">Nome da ficha</label>
    <input class="busca" id="fNome" placeholder="Ficha A — peito e tríceps" autocomplete="off">
    <label class="rot" for="fBusca">Exercícios</label>
    <input class="busca" id="fBusca" placeholder="Buscar exercício" autocomplete="off">
    <div id="fEscolhidos" class="escolhidos"></div>
    <div id="fResultados"></div>
    <button class="botao" id="salvarFicha">Criar ficha</button>`);
  const escolhidos = [];
  const pinta = () => {
    $('#fEscolhidos').innerHTML = escolhidos.length
      ? escolhidos.map((n, i) => `<button class="marca" data-tirar="${i}">${esc(n)} ✕</button>`).join('')
      : '<div class="sub">Nenhum exercício escolhido.</div>';
  };
  const lista = () => {
    const q = $('#fBusca').value.trim().toLowerCase();
    const achados = (q ? catalogo.filter((e) => e.nome.toLowerCase().includes(q)) : catalogo).slice(0, 8);
    $('#fResultados').innerHTML = achados.length
      ? achados.map((e) => `<button class="opcao" data-ex="${esc(e.nome)}"><div><div>${esc(e.nome)}</div><div class="sub">${esc(e.grupo)} · ${esc(e.equipamento)}</div></div></button>`).join('')
      : `<div class="vazio">Nada encontrado.${q ? ` <button class="destaque" data-ex="${esc($('#fBusca').value.trim())}">Usar "${esc($('#fBusca').value.trim())}"</button>` : ''}</div>`;
  };
  pinta(); lista();
  $('#fBusca').addEventListener('input', lista);
  $('#folhaConteudo').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-ex]');
    if (a) { if (!escolhidos.includes(a.dataset.ex)) escolhidos.push(a.dataset.ex); pinta(); return; }
    const t = ev.target.closest('[data-tirar]');
    if (t) { escolhidos.splice(+t.dataset.tirar, 1); pinta(); return; }
    if (ev.target.closest('#salvarFicha')) {
      const nome = $('#fNome').value.trim();
      if (!nome || !escolhidos.length) { return; }
      const ficha = { id: 'f' + Date.now(), nome, exercicios: escolhidos.map((n) => ({ nome: n, series: 3 })) };
      db.gravar(db.LOJAS.fichas, ficha).then(async () => {
        fichas = await db.todos(db.LOJAS.fichas);
        fecharFolha(); setTela('treino');
      });
    }
  });
}

function folhaNovaRefeicao() {
  const sugestoes = REFEICOES_PADRAO.filter((n) => !diaHoje.refeicoes.some((r) => r.nome === n));
  abrirFolha(`<h3>Adicionar refeição</h3>
    ${sugestoes.map((n) => `<button class="opcao" data-ref-nome="${esc(n)}"><div>${esc(n)}</div></button>`).join('')}
    <label class="rot" for="rNome">Ou um nome seu</label>
    <input class="busca" id="rNome" placeholder="Pré-treino" autocomplete="off">
    <button class="botao" id="salvarRefeicao">Adicionar</button>`);
}

function folhaAlimento(iRef) {
  abrirFolha(`<h3>Adicionar em ${esc(diaHoje.refeicoes[iRef].nome)}</h3>
    <input class="busca" id="buscaAlimento" placeholder="Buscar alimento" autocomplete="off">
    <div id="resultados"></div>`);
  const lista = () => {
    const q = $('#buscaAlimento').value.trim().toLowerCase();
    if (!q) { $('#resultados').innerHTML = `<div class="vazio">${alimentos.length} alimentos disponíveis. Digite para buscar.</div>`; return; }
    const achados = alimentos.filter((a) => a.nome.toLowerCase().includes(q)).slice(0, 8);
    $('#resultados').innerHTML = achados.length
      ? achados.map((a) => `<button class="opcao" data-alimento="${iRef}:${esc(a.id)}">
          <div><div>${esc(a.nome)}</div><div class="sub">${a.kcal.toFixed(0)} kcal · P ${n1(a.p)} C ${n1(a.c)} G ${n1(a.g)} por 100 g</div></div></button>`).join('')
      : '<div class="vazio">Nenhum alimento encontrado.</div>';
  };
  lista();
  $('#buscaAlimento').addEventListener('input', lista);
}

function folhaPorcao(iRef, idAli) {
  const a = alimentos.find((x) => String(x.id) === String(idAli));
  if (!a) return;
  abrirFolha(`<h3>${esc(a.nome)}</h3>
    <input class="busca" id="qtd" type="number" inputmode="decimal" value="100">
    <div class="sub" style="margin-bottom:14px">gramas</div>
    <button class="botao" data-confirma="${iRef}:${esc(idAli)}">Adicionar</button>`);
}

// =========================================================================
// Navegação e eventos
// =========================================================================

function setTela(nome) {
  telaAtual = nome;
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === `tela-${nome}`));
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.tela === nome));
  renderTudo();
  window.scrollTo(0, 0);
}

function renderTudo() {
  renderHoje(); renderTreino(); renderDieta(); renderPerfil();
  if (mesAberto !== null) renderMesAmpliado();
}

document.addEventListener('click', async (ev) => {
  const achar = (sel) => ev.target.closest(sel);
  let el;

  if ((el = achar('.aba'))) return setTela(el.dataset.tela);
  if (achar('#fab')) return folhaRegistro();
  if ((el = achar('[data-ir]'))) return setTela(el.dataset.ir);
  if (achar('#fecharAviso') || ev.target.id === 'folhaFundo') return fecharFolha();

  if ((el = achar('[data-ficha]'))) return abrirSessao(el.dataset.ficha);
  if (achar('#novaFicha')) return folhaNovaFicha();

  if ((el = achar('[data-feita]'))) {
    const [ie, is] = el.dataset.feita.split(':').map(Number);
    const s = sessao.exercicios[ie].series[is];
    s.feita = !s.feita;
    return renderTreino();
  }
  if (achar('#finalizar')) return pedirFinalizar();
  if (achar('#salvarNaFicha')) return finalizarSessao(true);
  if (achar('#soHoje')) return finalizarSessao(false);
  if (achar('#cancelar')) { sessao = null; return renderTreino(); }

  if ((el = achar('[data-modo]'))) {
    const ex = sessao.exercicios[+el.dataset.modo];
    ex.modo = ex.modo === 'cluster' ? 'linear' : 'cluster';
    // No cluster a carga é uma só: iguala todos os blocos à do primeiro.
    if (ex.modo === 'cluster') { const kg = ex.series[0]?.kg ?? null; ex.series.forEach((s) => { s.kg = kg; }); }
    return renderTreino();
  }
  if ((el = achar('[data-mais-serie]'))) {
    const ex = sessao.exercicios[+el.dataset.maisSerie];
    const ult = ex.series[ex.series.length - 1];
    ex.series.push({ kg: ult ? ult.kg : null, reps: ult ? ult.reps : null, feita: false });
    return renderTreino();
  }
  if ((el = achar('[data-menos-serie]'))) {
    const ex = sessao.exercicios[+el.dataset.menosSerie];
    if (ex.series.length > 1) ex.series.pop();
    return renderTreino();
  }
  if ((el = achar('[data-tirar-ex]'))) {
    sessao.exercicios.splice(+el.dataset.tirarEx, 1);
    if (!sessao.exercicios.length) { sessao = null; }
    return renderTreino();
  }
  if (achar('#addExercicio')) return folhaAddExercicio();
  if ((el = achar('[data-ax]'))) {
    const nome = el.dataset.ax;
    const ant = (await db.cargasAnteriores(sessao.fichaId))[nome];
    sessao.exercicios.push({
      nome, modo: 'linear',
      series: Array.from({ length: 3 }, () => ({ kg: ant ? ant.kg : null, reps: ant ? ant.reps : null, feita: false })),
    });
    fecharFolha();
    return renderTreino();
  }

  if (achar('#abrirCardio')) return folhaCardio();
  if (achar('#salvarCardio')) return salvarCardio();

  if ((el = achar('[data-mes]'))) return abrirMes(Number(el.dataset.mes));
  if (achar('#fecharMes')) { mesAberto = null; return $('#mesAmpliado').classList.remove('aberto'); }
  if ((el = achar('[data-dia]'))) { diaSelecionado = el.dataset.dia; renderMesAmpliado(); return mostrarDia(diaSelecionado); }

  if ((el = achar('[data-cor]'))) {
    document.documentElement.style.setProperty('--cor', el.dataset.cor);
    await db.salvarConfig('cor', el.dataset.cor);
    return renderPerfil();
  }

  if (achar('#abrirPerfil') || achar('#abrirPerfilTexto')) return folhaPerfil();
  if (achar('#salvarPerfil')) {
    perfil = {
      ...perfil,
      nome: $('#pNome').value.trim(),
      peso: Number($('#pPeso').value) || null,
      altura: Number($('#pAltura').value) || null,
    };
    await db.salvarPerfil(perfil);
    fecharFolha();
    return renderTudo();
  }

  if (achar('#novaRefeicao')) return folhaNovaRefeicao();
  if ((el = achar('[data-ref-nome]'))) {
    diaHoje.refeicoes.push({ nome: el.dataset.refNome, itens: [] });
    fecharFolha();
    return salvarDiaHoje();
  }
  if (achar('#salvarRefeicao')) {
    const nome = $('#rNome').value.trim();
    if (!nome) return;
    diaHoje.refeicoes.push({ nome, itens: [] });
    fecharFolha();
    return salvarDiaHoje();
  }

  if ((el = achar('[data-add-refeicao]'))) return folhaAlimento(Number(el.dataset.addRefeicao));
  if ((el = achar('[data-alimento]'))) {
    const [iRef, ...resto] = el.dataset.alimento.split(':');
    return folhaPorcao(Number(iRef), resto.join(':'));
  }
  if ((el = achar('[data-confirma]'))) {
    const [iRef, ...resto] = el.dataset.confirma.split(':');
    const a = alimentos.find((x) => String(x.id) === resto.join(':'));
    const q = Number($('#qtd').value) || 0;
    if (!a || q <= 0) return;
    const f = q / 100;
    diaHoje.refeicoes[Number(iRef)].itens.push({
      nome: a.nome, g_: q, kcal: a.kcal * f, p: a.p * f, c: a.c * f, g: a.g * f,
    });
    fecharFolha();
    return salvarDiaHoje();
  }
  if ((el = achar('[data-remover]'))) {
    const [i, j] = el.dataset.remover.split(':').map(Number);
    diaHoje.refeicoes[i].itens.splice(j, 1);
    return salvarDiaHoje();
  }
  if ((el = achar('[data-agua]'))) {
    diaHoje.agua = Math.max(0, (diaHoje.agua || 0) + Number(el.dataset.agua));
    return salvarDiaHoje();
  }
  if ((el = achar('[data-repetir]'))) return folhaRepetirSalva(Number(el.dataset.repetir));
  if ((el = achar('[data-usar-salva]'))) {
    const [iRef, id] = el.dataset.usarSalva.split(':');
    const s = salvas.find((x) => String(x.id) === id);
    if (s) diaHoje.refeicoes[Number(iRef)].itens.push(...s.itens.map((i) => ({ ...i })));
    fecharFolha();
    return salvarDiaHoje();
  }
  if ((el = achar('[data-salvar-ref]'))) return folhaSalvarRefeicao(Number(el.dataset.salvarRef));
  if ((el = achar('[data-confirma-salvar]'))) {
    const r = diaHoje.refeicoes[Number(el.dataset.confirmaSalvar)];
    await db.gravar(db.LOJAS.salvas, { nome: $('#sNome').value.trim() || r.nome, itens: r.itens.map((i) => ({ ...i })) });
    salvas = await db.todos(db.LOJAS.salvas);
    fecharFolha();
    return renderTudo();
  }
  if ((el = achar('[data-grade]'))) { gradeDe = el.dataset.grade; return renderPerfil(); }

  if ((el = achar('[data-reg]'))) {
    fecharFolha();
    if (el.dataset.reg === 'treino') return setTela('treino');
    if (el.dataset.reg === 'perfil') { setTela('perfil'); return folhaPerfil(); }
    if (el.dataset.reg === 'refeicao') {
      setTela('dieta');
      if (!diaHoje.refeicoes.length) return folhaNovaRefeicao();
      return folhaAlimento(0);
    }
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-campo]');
  if (!el || !sessao) return;
  const v = el.value === '' ? null : Number(el.value);
  const ex = sessao.exercicios[+el.dataset.e];
  if (el.dataset.campo === 'kgCluster') { ex.series.forEach((s) => { s.kg = v; }); return; }
  ex.series[+el.dataset.s][el.dataset.campo] = v;
});

document.addEventListener('change', (ev) => {
  if (ev.target.id !== 'arqFoto') return;
  const arq = ev.target.files?.[0];
  if (!arq) return;
  // shortcut: guarda a foto como dataURL no tamanho original.
  // Redimensionar antes de salvar quando as fotos de progresso entrarem (etapa 6).
  const leitor = new FileReader();
  leitor.onload = async () => {
    perfil = { ...perfil, foto: leitor.result };
    await db.salvarPerfil(perfil);
    folhaPerfil();
    renderPerfil();
  };
  leitor.readAsDataURL(arq);
});

// =========================================================================
// Início
// =========================================================================

carregar().catch((e) => {
  console.error(e);
  const bloqueado = String(e.message || e).startsWith('bloqueado');
  $('#tela-hoje').innerHTML = `<header class="topo"><h1>Hoje</h1></header>
    <div class="card"><div class="vazio">${bloqueado
      ? 'O app está aberto em outra aba com uma versão anterior. Feche as outras e abra de novo.'
      : 'Não deu para abrir o armazenamento do aparelho. Em aba anônima o navegador bloqueia, e aí nada fica salvo.'}</div></div>`;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
