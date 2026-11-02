import { MESES, DIAS_SEMANA, chaveDia, diasDoMes, somaMacros, dataLonga, somaDias } from './datas.js';
import * as db from './db.js';
import {
  somaBlocos, repsDaSerie, novaSerie, cargaDeTopo, backoff, modosDaFicha,
  temBlocos, trocarTipo, lerNumero, virgula, textoDoTreino,
} from './treino.js';
import { itensComidos, montarDia, comQuantidade } from './dieta.js';

const HOJE = new Date();
const ANO = HOJE.getFullYear();
const CHAVE_HOJE = chaveDia(HOJE);
const REFEICOES_PADRAO = ['Café da manhã', 'Almoço', 'Lanche', 'Jantar'];

// ---- estado em memória, espelho do que está no banco ----
let perfil = { id: 'eu', nome: '', peso: null, altura: null, foto: null };
let fichas = [];
let diasTreino = new Set();
let diaHoje = { data: CHAVE_HOJE, refeicoes: [], agua: 0 };
let diaDieta = diaHoje; // o dia aberto na aba Dieta: hoje, ou um passado que ele voltou para corrigir
let sessao = null;
let sessoes = [];    // treinos já gravados, do mais novo para o mais velho
let recordes = {};   // exercício -> { kg, reps, data }
let salvas = [];     // refeições salvas para repetir
let diasDieta = {};  // data -> kcal somadas
let plano = null;    // dados/plano-alimentar.json, quando existe
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
  [perfil, fichas, diasTreino, diaHoje, recordes, salvas, diasDieta, sessoes] = await Promise.all([
    db.perfil(), db.todos(db.LOJAS.fichas), db.diasComTreino(), db.dia(CHAVE_HOJE),
    db.recordes(), db.todos(db.LOJAS.salvas), db.diasComDieta(), db.historico(),
  ]);
  // As quatro refeições do dia já vêm postas; o usuário acrescenta outras se quiser.
  if (!diaHoje.refeicoes.length) diaHoje.refeicoes = REFEICOES_PADRAO.map((nome) => ({ nome, itens: [] }));
  diaDieta = diaHoje;
  gradeDe = (await db.config('gradeDe')) || 'treino';

  // Retoma um treino que ficou aberto: o app pode ter sido encerrado no meio.
  const aberta = await db.config('sessaoAberta');
  if (aberta && aberta.data === CHAVE_HOJE) { sessao = aberta; tocarRelogio(); }
  else if (aberta) await db.salvarConfig('sessaoAberta', null);
  const cor = await db.config('cor');
  if (cor) document.documentElement.style.setProperty('--cor', cor);
  renderTudo();
  carregarCatalogos();
}

async function carregarCatalogos() {
  const [ex, taco, meus, p] = await Promise.all([
    fetch('dados/exercicios.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch('dados/taco.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    db.todos(db.LOJAS.alimentos).catch(() => []),
    // O service worker serve os dados pelo cache: mudou o arquivo, muda o ?v aqui e no sw.js.
    fetch('dados/plano-alimentar.json?v=2').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (p) { plano = p; await aplicarPlano(); montarDia(diaHoje, plano); }
  catalogo = ex;
  alimentos = [
    ...meus,
    ...taco.map((a) => ({
      id: a.id, nome: a.nome,
      kcal: nz(a.por100g?.kcal), p: nz(a.por100g?.proteina),
      c: nz(a.por100g?.carboidrato), g: nz(a.por100g?.gordura),
    })),
  ];
  renderTudo(); // o plano e o catálogo chegam depois da primeira tela
}

/**
 * As refeições do plano viram refeições salvas, uma vez só, para ele registrar
 * o dia com um toque em cada. Depois disso são dele: editar ou apagar não as traz
 * de volta, por isso a marca em config.
 */
async function aplicarPlano() {
  if (await db.config('planoImportado')) return;
  for (const r of plano.refeicoes) {
    await db.gravar(db.LOJAS.salvas, { nome: r.nome, itens: r.itens.map((i) => ({ ...i })) });
  }
  await db.salvarConfig('planoImportado', plano.origem || true);
  salvas = await db.todos(db.LOJAS.salvas);
  renderTudo();
}

/**
 * Aderência do dia: o quanto do plano foi registrado.
 * Verde a partir de 90%, amarelo abaixo disso, vermelho abaixo de 60% — a regra
 * que o usuário escreveu. Sem plano, não há como calcular e a grade só acende.
 */
function corDoDia(kcal) {
  if (!plano || !kcal) return '';
  const pct = (kcal / plano.alvo.kcal) * 100;
  if (pct < 60) return 'vermelho';
  if (pct < 90) return 'amarelo';
  return 'verde';
}

// =========================================================================
// Hoje
// =========================================================================

function macrosDoDia() {
  return somaMacros(itensComidos(diaHoje.refeicoes));
}

function renderHoje() {
  const sessoes = [...diasTreino].includes(CHAVE_HOJE);
  const m = macrosDoDia();
  const temComida = m.kcal > 0;
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
        : `<div class="vazio">Nenhuma refeição concluída hoje.</div>
           <button class="botao" data-ir="dieta">Abrir a dieta</button>`}
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
    const editando = !!sessao.editando;
    el.innerHTML = `
      <header class="topo fixo ${editando ? 'editando' : ''}">
        <div class="linha-crono">
          ${editando ? '' : `<div class="cronometro" id="cronometro">${relogio()}</div>`}
          <h1>${esc(sessao.nome)}</h1>
        </div>
        <div class="data">${editando ? dataLonga(sessao.data, ANO) + ' · ' : ''}${todas.length ? `${feitas} de ${todas.length} séries` : 'Adicione o primeiro exercício'}</div>
      </header>
      ${sessao.exercicios.map((ex, ie) => cartaoExercicio(ex, ie)).join('')}
      ${editando
        ? `<button class="botao" id="salvarEdicao">Salvar</button>
           <button class="botao fraco" id="exportarTreino">Exportar em texto</button>
           <button class="botao fraco" id="cancelar">Cancelar</button>
           <button class="botao fraco" id="apagarSessao" data-sessao-id="${sessao.editando}">Apagar treino</button>`
        : `${sessao.exercicios.length ? `<button class="botao" id="finalizar">Finalizar treino</button>
             <button class="botao fraco" id="exportarTreino">Exportar em texto</button>` : ''}
           <button class="botao fraco" id="cancelar">Cancelar</button>`}
      <div class="acao-fixa"><button class="botao ${sessao.exercicios.length ? 'fraco' : ''}" id="addExercicio">Adicionar exercício</button></div>`;
    el.classList.add('com-acao');
    agendarGuardar();
    return;
  }

  el.classList.remove('com-acao');
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
    <button class="botao fraco" id="abrirCardio">Registrar cardio</button>
    ${sessoes.length ? `<div class="card">
      <h2>Treinos feitos</h2>
      ${sessoes.map((s) => `<button class="linha-item linha-toque" data-sessao="${s.id}">
        <div><div>${esc(s.nome)}</div><div class="sub">${dataLonga(s.data, ANO)} · ${resumoSessao(s)}</div></div>
        <div class="sub">›</div></button>`).join('')}
    </div>` : ''}`;
}

/** O que cada treino foi, numa linha só. */
function resumoSessao(s) {
  if (s.tipo === 'cardio') return `${s.minutos} min`;
  const ex = (s.exercicios || []).length;
  const se = (s.exercicios || []).reduce((t, e) => t + (e.series || []).length, 0);
  return `${ex} exercício${ex === 1 ? '' : 's'} · ${se} série${se === 1 ? '' : 's'}`;
}

/**
 * Abre um treino já gravado na mesma tela de sessão, para corrigir o que ficou
 * errado. Toda série gravada volta marcada: só o que está marcado é regravado.
 */
function editarSessao(id) {
  const s = sessoes.find((x) => x.id === id);
  if (!s) return;
  if (s.tipo === 'cardio') return folhaCardio(s);
  sessao = {
    editando: s.id, fichaId: s.fichaId || null, nome: s.nome, data: s.data,
    inicio: Date.now(),
    exercicios: (s.exercicios || []).map((e) => ({
      nome: e.nome,
      obs: e.obs || '',
      series: (e.series || []).map((x) => ({ ...novaSerie(x), rir: x.rir ?? null, feita: true })),
    })),
  };
  setTela('treino');
}

function folhaAddExercicio() {
  // Os resultados ficam ACIMA do campo: embaixo dele o teclado os cobria.
  abrirFolha(`<h3>Adicionar exercício</h3>
    <div id="axResultados"></div>
    <input class="busca" id="axBusca" placeholder="Buscar exercício" autocomplete="off">`);
  const lista = () => {
    const q = $('#axBusca').value.trim();
    const ql = q.toLowerCase();
    const achados = (ql ? catalogo.filter((e) => e.nome.toLowerCase().includes(ql)) : catalogo).slice(0, 8);
    $('#axResultados').innerHTML = achados.length
      ? achados.map((e) => `<button class="opcao" data-ax="${esc(e.nome)}">
          <div><div>${esc(e.nome)}</div><div class="sub">${esc(e.grupo)} · ${esc(e.equipamento)}</div></div></button>`).join('')
        // O nome dele é o que sai no texto exportado, mesmo quando o catálogo tem parecido.
        + (q && !achados.some((e) => e.nome.toLowerCase() === ql)
          ? `<button class="opcao" data-ax="${esc(q)}"><div><div>Usar "${esc(q)}"</div><div class="sub">Com o nome que você digitou</div></div></button>`
          : '')
      : `<div class="vazio">Nada encontrado.${q ? ` <button class="destaque" data-ax="${esc(q)}">Usar "${esc(q)}"</button>` : ''}</div>`;
    // Com a lista crescendo para cima, a folha precisa descer até o campo.
    const f = $('#folha');
    f.scrollTop = f.scrollHeight;
  };
  lista();
  $('#axBusca').addEventListener('input', lista);
}

const TIPOS = {
  linear: { rotulo: 'lin', nome: 'linear' },
  cluster: { rotulo: 'clu', nome: 'cluster' },
  restpause: { rotulo: 'rp', nome: 'rest pause' },
};

// shortcut: nome próprio só é reconhecido se começar como no catálogo: "Mergulho" sai com +, "Dips" não. Virar marca no exercício se isso pegar.
const ehCorporal = (nome) => catalogo.some((e) => e.equipamento === 'peso-corporal' && e.nome.toLowerCase().startsWith(nome.toLowerCase()));

/**
 * O tipo é de cada série, não do exercício: dá para fazer uma linear e uma
 * cluster no mesmo exercício. Na cluster e no rest pause a carga é uma só e as
 * reps saem das partes, então a coluna de reps vira a soma delas e as partes
 * ficam na linha de baixo. No peso corporal a carga é o que foi somado.
 */
function cartaoExercicio(ex, ie) {
  const rec = recordes[ex.nome];
  const rotuloKg = ehCorporal(ex.nome) ? '+kg' : 'kg';
  // PR é a maior carga já feita — e o que já foi marcado hoje também conta.
  // Sem isso o backoff de 72 kg virava PR logo depois da série de 80.
  const bateuPr = (s, is) => s.feita && s.kg != null && (!rec || s.kg > rec.kg)
    && !ex.series.some((o, io) => io < is && o.feita && o.kg >= s.kg);

  const linhas = ex.series.map((s, is) => {
    const comBlocos = temBlocos(s.modo);
    const tipo = TIPOS[s.modo] || TIPOS.linear;
    const blocos = s.blocos?.length ? s.blocos : [null];
    return `
    <div class="serie ${s.feita ? 'feita' : ''}">
      <button class="tipo ${comBlocos ? 'marcado' : ''}" data-modo-serie="${ie}:${is}" aria-label="Tipo da série: ${tipo.nome}">${tipo.rotulo}</button>
      <input type="text" inputmode="decimal" autocomplete="off" placeholder="${rotuloKg}" value="${virgula(s.kg)}" data-campo="kg" data-e="${ie}" data-s="${is}">
      ${comBlocos
        ? `<div class="soma" id="soma-${ie}-${is}">${virgula(somaBlocos(s.blocos)) || '—'}</div>`
        : `<input type="text" inputmode="decimal" autocomplete="off" placeholder="reps" value="${virgula(s.reps)}" data-campo="reps" data-e="${ie}" data-s="${is}">`}
      <input type="number" inputmode="numeric" placeholder="–" value="${s.rir ?? ''}" data-campo="rir" data-e="${ie}" data-s="${is}">
      <button class="ok" data-feita="${ie}:${is}">${bateuPr(s, is) ? 'PR' : '✓'}</button>
    </div>
    ${comBlocos ? `<div class="blocos">
      ${blocos.map((b, ib) => `<input type="text" inputmode="decimal" autocomplete="off" value="${virgula(b)}" data-bloco="${ie}:${is}:${ib}" aria-label="Parte ${ib + 1}">`).join('<span class="mais">+</span>')}
      <button class="chip" data-mais-bloco="${ie}:${is}">${s.modo === 'restpause' ? '+ rest pause' : '+ bloco'}</button>
      ${blocos.length > 1 ? `<button class="chip" data-menos-bloco="${ie}:${is}">−</button>` : ''}
    </div>` : ''}`;
  }).join('');

  return `<div class="card">
    <div class="ex-cab">
      <h2>${esc(ex.nome)}</h2>
      <button class="chip apagar" data-tirar-ex="${ie}" aria-label="Remover exercício">✕</button>
    </div>
    ${rec ? `<div class="sub">recorde ${virgula(rec.kg)} kg${rec.reps ? ' × ' + virgula(rec.reps) : ''}</div>` : ''}
    <div class="serie-cab"><span>tipo</span><span>${rotuloKg}</span><span>reps</span><span>rir</span><span></span></div>
    ${linhas}
    <div class="ex-pe" id="backoff-${ie}">${chipsBackoff(ex, ie)}</div>
    <div class="ex-pe">
      <button class="chip" data-menos-serie="${ie}">− série</button>
      <button class="chip" data-mais-serie="${ie}">+ série</button>
    </div>
    <textarea class="obs" rows="2" placeholder="Observação deste exercício" data-obs="${ie}">${esc(ex.obs || '')}</textarea>
  </div>`;
}

/** A série apontada por um data-* no formato "exercício:série". */
function serieDe(ref) {
  const [ie, is] = ref.split(':').map(Number);
  return sessao.exercicios[ie].series[is];
}

/** Backoff da maior carga digitada no exercício. Tocar acrescenta a série já com o peso. */
function chipsBackoff(ex, ie) {
  const topo = cargaDeTopo(ex.series);
  if (topo == null) return '';
  return `<span class="sub">backoff</span>
    <button class="chip" data-backoff="${ie}:0.9">90% · ${n1(backoff(topo, 0.9))}</button>
    <button class="chip" data-backoff="${ie}:0.8">80% · ${n1(backoff(topo, 0.8))}</button>`;
}

// ---- cronômetro da sessão ----

let tique = null;

function relogio() {
  const s = Math.max(0, Math.floor((Date.now() - (sessao?.inicio || Date.now())) / 1000));
  const d = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${d(Math.floor(s / 60) % 60)}:${d(s % 60)}` : `${d(Math.floor(s / 60))}:${d(s % 60)}`;
}

/** Atualiza só o texto do relógio: redesenhar a tela tiraria o foco dos campos. */
function tocarRelogio() {
  clearInterval(tique);
  tique = setInterval(() => {
    const el = $('#cronometro');
    if (!sessao) return clearInterval(tique);
    if (el) el.textContent = relogio();
  }, 1000);
}

function minutosDaSessao() {
  return Math.max(1, Math.round((Date.now() - sessao.inicio) / 60000));
}

/** Guarda a sessão em andamento: o iPhone encerra o app em segundo plano. */
async function guardarSessao() {
  if (sessao?.editando) return; // editar um treino gravado não mexe no que está em andamento
  await db.salvarConfig('sessaoAberta', sessao ? { ...sessao, data: CHAVE_HOJE } : null);
}

let guardaPendente = null;
function agendarGuardar() {
  clearTimeout(guardaPendente);
  guardaPendente = setTimeout(guardarSessao, 500);
}

/** Sessão sem ficha: começa vazia e os exercícios entram conforme ele treina. */
function novaSessaoLivre() {
  sessao = { fichaId: null, nome: 'Treino', inicio: Date.now(), exercicios: [] };
  tocarRelogio();
  guardarSessao();
  setTela('treino');
}

async function abrirSessao(fichaId) {
  const f = fichas.find((x) => x.id === fichaId);
  if (!f) return;
  const anteriores = await db.cargasAnteriores(fichaId);
  sessao = {
    fichaId, nome: f.nome, inicio: Date.now(),
    exercicios: f.exercicios.map((e) => ({
      nome: e.nome,
      obs: '',
      series: modosDaFicha(e).map((modo) => novaSerie({ ...anteriores[e.nome], modo })),
    })),
  };
  tocarRelogio();
  guardarSessao();
  setTela('treino');
}

/** Como a ficha ficaria se as mudanças desta sessão fossem salvas nela. */
function fichaDaSessao() {
  return sessao.exercicios.map((e) => ({
    nome: e.nome,
    series: e.series.length,
    modos: e.series.map((s) => s.modo || 'linear'),
  }));
}

function fichaMudou() {
  const f = fichas.find((x) => x.id === sessao.fichaId);
  if (!f) return false;
  const chave = (e) => `${e.nome}|${modosDaFicha(e).join(',')}`;
  const antes = f.exercicios.map(chave).join('~');
  const agora = fichaDaSessao().map(chave).join('~');
  return antes !== agora;
}

function pedirFinalizar() {
  const feitas = sessao.exercicios.flatMap((e) => e.series).filter((s) => s.feita).length;
  if (!feitas) { alerta('Marque pelo menos uma série antes de finalizar.'); return; }

  // Sessão livre: não havia ficha, então a pergunta é se vira uma.
  if (!sessao.fichaId) {
    abrirFolha(`<h3>Treino de ${relogio()}</h3>
      <div class="sub" style="margin-bottom:14px">Salvar ${sessao.exercicios.length === 1 ? 'este exercício' : `estes ${sessao.exercicios.length} exercícios`} como uma ficha, para repetir depois?</div>
      <label class="rot" for="nfNome">Nome da ficha</label>
      <input class="busca" id="nfNome" placeholder="Ficha A — peito e tríceps" autocomplete="off">
      <button class="botao" id="salvarComoFicha">Salvar como ficha</button>
      <button class="botao fraco" id="soHoje">Só registrar o treino</button>`);
    return;
  }

  if (!fichaMudou()) return finalizarSessao(false);

  abrirFolha(`<h3>Você mudou a ficha durante o treino</h3>
    <div class="sub" style="margin-bottom:16px">Salvar essas mudanças em "${esc(sessao.nome)}" para as próximas vezes?</div>
    <button class="botao" id="salvarNaFicha">Salvar na ficha</button>
    <button class="botao fraco" id="soHoje">Só para hoje</button>`);
}

/** Só o que está marcado vai para o banco. Serve para finalizar e para editar. */
function exerciciosGravados() {
  return sessao.exercicios.map((e) => ({
    nome: e.nome,
    obs: (e.obs || '').trim(),
    // reps de cluster e rest pause é a soma das partes: assim recorde e histórico leem tudo igual.
    series: e.series.filter((s) => s.feita).map((s) => ({
      modo: s.modo || 'linear', kg: s.kg, reps: repsDaSerie(s), rir: s.rir ?? null,
      blocos: temBlocos(s.modo) ? s.blocos : null,
    })),
  })).filter((e) => e.series.length);
}

/** O texto para colar onde ele posta o treino. Só entra o que está marcado. */
function folhaExportar() {
  const texto = textoDoTreino(exerciciosGravados(), ehCorporal);
  if (!texto) return alerta('Marque pelo menos uma série com as reps para exportar.');
  abrirFolha(`<h3>Exportar treino</h3>
    <textarea class="obs" id="textoTreino" rows="${texto.split('\n').length + 2}" readonly>${esc(texto)}</textarea>
    <button class="botao" id="copiarTreino">Copiar</button>`);
}

/** Gravar ou apagar um treino mexe na lista, na grade e nos recordes ao mesmo tempo. */
async function recarregarTreinos() {
  [sessoes, diasTreino, recordes] = await Promise.all([
    db.historico(), db.diasComTreino(), db.recordes(),
  ]);
}

/** Regrava um treino já existente, mantendo a data e o tempo originais. */
async function salvarEdicao() {
  const exercicios = exerciciosGravados();
  if (!exercicios.length) return alerta('Deixe pelo menos uma série marcada, ou apague o treino.');
  const antiga = sessoes.find((x) => x.id === sessao.editando);
  await db.gravar(db.LOJAS.sessoes, { ...antiga, exercicios });
  sessao = null;
  await recarregarTreinos();
  setTela('treino');
}

async function finalizarSessao(salvarNaFicha, nomeNovaFicha) {
  const exercicios = exerciciosGravados();

  let fichaId = sessao.fichaId;
  if (nomeNovaFicha) {
    fichaId = 'f' + Date.now();
    await db.gravar(db.LOJAS.fichas, { id: fichaId, nome: nomeNovaFicha, exercicios: fichaDaSessao() });
  } else if (salvarNaFicha) {
    const f = fichas.find((x) => x.id === fichaId);
    if (f) await db.gravar(db.LOJAS.fichas, { ...f, exercicios: fichaDaSessao() });
  }

  await db.gravar(db.LOJAS.sessoes, {
    data: CHAVE_HOJE, tipo: 'musculacao', fichaId, nome: nomeNovaFicha || sessao.nome,
    exercicios, minutos: minutosDaSessao(), em: new Date().toISOString(),
  });

  clearInterval(tique);
  sessao = null;
  await guardarSessao();
  fichas = await db.todos(db.LOJAS.fichas);
  await recarregarTreinos();
  fecharFolha();
  setTela('perfil');
}

/** Com uma sessão, a mesma folha edita o cardio que já foi gravado. */
function folhaCardio(s) {
  // A atividade dele entra na lista mesmo se sair do catálogo: salvar não pode renomear.
  const nomes = [...new Set([...(s ? [s.nome] : []), ...catalogo.filter((e) => e.tipo === 'cardio').map((e) => e.nome)])];
  abrirFolha(`<h3>${s ? 'Editar cardio' : 'Registrar cardio'}</h3>
    ${s ? `<div class="sub" style="margin:-8px 0 14px">${dataLonga(s.data, ANO)}</div>` : ''}
    <label class="rot" for="cTipo">O quê</label>
    <select class="busca" id="cTipo">
      ${nomes.map((n) => `<option value="${esc(n)}"${s && s.nome === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <label class="rot" for="cMin">Tempo (minutos)</label>
    <input class="busca" id="cMin" type="number" inputmode="numeric" placeholder="30" value="${s ? s.minutos : ''}">
    <button class="botao" id="salvarCardio"${s ? ` data-edita="${s.id}"` : ''}>${s ? 'Salvar' : 'Registrar'}</button>
    ${s ? `<button class="botao fraco" id="apagarSessao" data-sessao-id="${s.id}">Apagar treino</button>` : ''}`);
}

async function salvarCardio(id) {
  const atividade = $('#cTipo').value;
  const minutos = Number($('#cMin').value) || 0;
  if (!atividade || minutos <= 0) return;
  const antiga = id ? sessoes.find((x) => x.id === id) : null;
  await db.gravar(db.LOJAS.sessoes, {
    ...antiga,
    data: antiga ? antiga.data : CHAVE_HOJE, tipo: 'cardio', nome: atividade, minutos,
    exercicios: [], em: antiga ? antiga.em : new Date().toISOString(),
  });
  await recarregarTreinos();
  fecharFolha();
  setTela(antiga ? 'treino' : 'perfil');
}

// =========================================================================
// Dieta
// =========================================================================

/** Abre um dia na aba Dieta. Dia passado monta igual ao de hoje e só grava se ele mexer. */
async function abrirDiaDieta(chave) {
  diaDieta = chave === CHAVE_HOJE ? diaHoje : montarDia(await db.dia(chave), plano);
  setTela('dieta');
}

function renderDieta() {
  const refs = diaDieta.refeicoes;
  const m = somaMacros(itensComidos(refs));
  const k = diaDieta.data;
  const ehHoje = k === CHAVE_HOJE;
  $('#tela-dieta').innerHTML = `
    <header class="topo"><h1>Dieta</h1>
      <div class="navega-dia">
        <button class="chip" data-dia-dieta="${somaDias(k, -1)}" aria-label="Dia anterior">‹</button>
        <span class="data ${ehHoje ? '' : 'destaque'}">${ehHoje ? 'Hoje' : dataLonga(k, ANO)}</span>
        ${ehHoje ? '' : `<button class="chip" data-dia-dieta="${somaDias(k, 1)}" aria-label="Dia seguinte">›</button>
          <button class="chip" data-dia-dieta="${CHAVE_HOJE}">hoje</button>`}
      </div>
    </header>

    <div class="card">
      <div class="linha-item">
        <div><div class="num-grande ${m.kcal ? 'destaque' : ''}">${m.kcal.toFixed(0)}</div>
          <div class="sub" style="margin-top:6px">kcal das refeições concluídas</div></div>
      </div>
      ${m.kcal ? `<div class="linha-item"><div class="sub">P ${n1(m.p)} g · C ${n1(m.c)} g · G ${n1(m.g)} g</div></div>` : ''}
    </div>

    ${refs.length
      ? refs.map(cartaoRefeicao).join('')
      : `<div class="card"><div class="vazio">Nenhuma refeição ${ehHoje ? 'hoje' : 'neste dia'}.</div></div>`}

    <div class="card">
      <h2>Água</h2>
      <div class="linha-item">
        <div><div class="num-grande ${diaDieta.agua ? 'destaque' : ''}">${(diaDieta.agua / 1000).toFixed(1).replace('.', ',')}</div>
          <div class="sub" style="margin-top:6px">litros ${ehHoje ? 'hoje' : 'neste dia'}</div></div>
        <div class="ex-pe" style="margin:0">
          <button class="chip" data-agua="-250">−</button>
          <button class="chip" data-agua="250">+ copo</button>
          <button class="chip" data-agua="500">+ garrafa</button>
        </div>
      </div>
    </div>

    <button class="botao fraco" id="novaRefeicao">Adicionar refeição</button>`;
}

/** Uma refeição do dia: o box conclui, e tocar num alimento muda o que ele comeu. */
function cartaoRefeicao(r, i) {
  const s = somaMacros(r.itens);
  const feita = r.feita !== false;
  const refeicoesPlano = plano?.refeicoes || [];
  const igualA = (outra) => JSON.stringify(r.itens) === JSON.stringify(outra.itens);
  const original = refeicoesPlano.find((p) => p.nome === r.nome);
  return `<div class="card refeicao ${feita ? 'concluida' : ''}">
    <div class="ex-cab">
      <h2>${esc(r.nome)}</h2>
      <button class="concluir" data-concluir="${i}" aria-pressed="${feita}" aria-label="Concluir ${esc(r.nome)}">✓</button>
    </div>
    ${r.itens.length
      ? r.itens.map((it, j) => `<button class="linha-item linha-toque" data-item="${i}:${j}">
          <div><div>${esc(it.nome)}</div><div class="sub">${n1(it.g_)} g</div></div>
          <div class="sub">${it.kcal.toFixed(0)} kcal ›</div></button>`).join('')
      : '<div class="vazio">Nada registrado.</div>'}
    ${r.itens.length ? `<div class="sub" style="margin-top:10px">${s.kcal.toFixed(0)} kcal · P ${s.p.toFixed(0)} C ${s.c.toFixed(0)} G ${s.g.toFixed(0)}</div>` : ''}
    <div class="ex-pe">
      <button class="chip" data-add-refeicao="${i}">+ alimento</button>
      ${refeicoesPlano.map((o, k) => (o.opcaoDe?.includes(r.nome) && !igualA(o)
        ? `<button class="chip" data-opcao="${i}:${k}">trocar por ${esc(o.rotulo)}</button>` : '')).join('')}
      ${original && !igualA(original) ? `<button class="chip" data-voltar-plano="${i}">voltar ao plano</button>` : ''}
      ${salvas.length ? `<button class="chip" data-repetir="${i}">repetir salva</button>` : ''}
      ${r.itens.length ? `<button class="chip" data-salvar-ref="${i}">salvar</button>` : ''}
    </div>
  </div>`;
}

/** Onde ele muda o que comeu: outra quantidade, ou tirar da refeição. */
function folhaItem(i, j) {
  const it = diaDieta.refeicoes[i].itens[j];
  abrirFolha(`<h3>${esc(it.nome)}</h3>
    <label class="rot" for="qtd">Quanto você comeu (g)</label>
    <input class="busca" id="qtd" type="text" inputmode="decimal" autocomplete="off" value="${virgula(it.g_)}">
    <button class="botao" data-salvar-item="${i}:${j}">Salvar</button>
    <button class="botao fraco" data-remover="${i}:${j}">Tirar da refeição</button>`);
}

async function salvarDiaDieta() {
  await db.salvarDia(diaDieta);
  diasDieta = await db.diasComDieta();
  renderTudo();
}

function folhaRepetirSalva(iRef) {
  abrirFolha(`<h3>Repetir uma refeição salva</h3>
    ${salvas.map((s) => {
      const t = somaMacros(s.itens);
      return `<button class="opcao" data-usar-salva="${iRef}:${s.id}">
        <div><div>${esc(s.nome)}</div>
          <div class="sub">${s.itens.length === 1 ? '1 item' : s.itens.length + ' itens'} · ${t.kcal.toFixed(0)} kcal</div></div></button>`;
    }).join('')}`);
}

function folhaSalvarRefeicao(iRef) {
  const r = diaDieta.refeicoes[iRef];
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
        <span><span class="num-grande ${total ? 'destaque' : ''}">${total}</span> <span class="sub">${total === 1 ? 'dia' : 'dias'}</span></span>
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
    const cor = gradeDe === 'dieta' ? corDoDia(diasDieta[k]) : '';
    q += `<span class="${['d', dias.has(k) ? 'on' : '', cor, k === CHAVE_HOJE ? 'hoje' : ''].filter(Boolean).join(' ')}"></span>`;
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
    const cor = gradeDe === 'dieta' ? corDoDia(diasDieta[k]) : '';
    const cls = [dias.has(k) ? 'on' : '', cor, k === CHAVE_HOJE ? 'hoje' : '', k === diaSelecionado ? 'sel' : ''].filter(Boolean).join(' ');
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
  const m = somaMacros(itensComidos(d.refeicoes));
  const alvo = $('#detalheDia');
  if (!alvo) return;
  alvo.innerHTML = `<h2>${dataLonga(k, ANO)}</h2>
    ${sessoes.length
      ? sessoes.map((s) => `<div class="linha-item"><div><div>${esc(s.nome)}</div>
          <div class="sub">${s.tipo === 'cardio' ? s.minutos + ' min' : s.exercicios.length + ' exercício' + (s.exercicios.length === 1 ? '' : 's')}</div></div>
          <div class="destaque">✓</div></div>`).join('')
      : '<div class="linha-item"><div class="sub">Sem treino.</div></div>'}
    ${m.kcal
      ? `<div class="linha-item"><div>Dieta</div><div class="sub">${m.kcal.toFixed(0)} kcal</div></div>`
      : '<div class="linha-item"><div class="sub">Sem refeições concluídas.</div></div>'}
    ${k <= CHAVE_HOJE ? `<button class="botao fraco" data-abrir-dieta="${k}">Abrir a dieta deste dia</button>` : ''}`;
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
    <button class="opcao" data-reg="treino"><span class="bolha">🏋️</span><div><div>Treino</div><div class="sub">${sessao ? 'Voltar para o treino em andamento' : 'Começa agora, com o tempo correndo'}</div></div></button>
    ${fichas.length && !sessao ? `<button class="opcao" data-reg="ficha"><span class="bolha">📋</span><div><div>Treino por ficha</div><div class="sub">${fichas.length} ficha${fichas.length === 1 ? '' : 's'} salva${fichas.length === 1 ? '' : 's'}</div></div></button>` : ''}
    <button class="opcao" data-reg="cardio"><span class="bolha">🏃</span><div><div>Cardio</div><div class="sub">Tipo e tempo</div></div></button>
    <button class="opcao" data-reg="refeicao"><span class="bolha">🍽️</span><div><div>Refeição</div><div class="sub">Marcar o que comeu</div></div></button>
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
  const sugestoes = plano ? [] : REFEICOES_PADRAO.filter((n) => !diaDieta.refeicoes.some((r) => r.nome === n));
  abrirFolha(`<h3>Adicionar refeição</h3>
    ${sugestoes.map((n) => `<button class="opcao" data-ref-nome="${esc(n)}"><div>${esc(n)}</div></button>`).join('')}
    <label class="rot" for="rNome">${sugestoes.length ? 'Ou um nome seu' : 'Nome'}</label>
    <input class="busca" id="rNome" placeholder="Pré-treino" autocomplete="off">
    <button class="botao" id="salvarRefeicao">Adicionar</button>`);
}

function folhaAlimento(iRef) {
  abrirFolha(`<h3>Adicionar em ${esc(diaDieta.refeicoes[iRef].nome)}</h3>
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
    <input class="busca" id="qtd" type="text" inputmode="decimal" autocomplete="off" value="100">
    <div class="sub" style="margin-bottom:14px">gramas</div>
    <button class="botao" data-confirma="${iRef}:${esc(idAli)}">Adicionar</button>`);
}

// =========================================================================
// Navegação e eventos
// =========================================================================

function setTela(nome) {
  telaAtual = nome;
  // Sair da aba volta para hoje: marcar refeição no dia errado sem perceber é o pior erro aqui.
  if (nome !== 'dieta') diaDieta = diaHoje;
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
  if ((el = achar('[data-sessao]'))) return editarSessao(Number(el.dataset.sessao));
  if (achar('#salvarEdicao')) return salvarEdicao();

  if ((el = achar('#apagarSessao'))) {
    const alvo = sessoes.find((x) => x.id === Number(el.dataset.sessaoId));
    if (!alvo) return;
    return abrirFolha(`<h3>Apagar este treino?</h3>
      <div class="sub" style="margin-bottom:16px">${esc(alvo.nome)}, ${dataLonga(alvo.data, ANO)}. Some de vez.</div>
      <button class="botao" id="apagarMesmo" data-sessao-id="${alvo.id}">Apagar</button>
      <button class="botao fraco" id="fecharAviso">Manter</button>`);
  }
  if ((el = achar('#apagarMesmo'))) {
    await db.apagar(db.LOJAS.sessoes, Number(el.dataset.sessaoId));
    sessao = null;
    await recarregarTreinos();
    fecharFolha();
    return setTela('treino');
  }

  if ((el = achar('[data-feita]'))) {
    const [ie, is] = el.dataset.feita.split(':').map(Number);
    const s = sessao.exercicios[ie].series[is];
    s.feita = !s.feita;
    return renderTreino();
  }
  if (achar('#finalizar')) return pedirFinalizar();
  if (achar('#exportarTreino')) return folhaExportar();
  if ((el = achar('#copiarTreino'))) {
    try {
      await navigator.clipboard.writeText($('#textoTreino').value);
      el.textContent = 'Copiado';
    } catch {
      $('#textoTreino').select();
      el.textContent = 'Segure no texto para copiar';
    }
    return;
  }
  if (achar('#salvarNaFicha')) return finalizarSessao(true);
  if (achar('#soHoje')) return finalizarSessao(false);
  if (achar('#salvarComoFicha')) {
    const nome = $('#nfNome').value.trim();
    if (!nome) return;
    return finalizarSessao(false, nome);
  }
  if (achar('#cancelar')) {
    clearInterval(tique);
    sessao = null;
    await guardarSessao();
    return renderTreino();
  }

  if ((el = achar('[data-modo-serie]'))) {
    trocarTipo(serieDe(el.dataset.modoSerie));
    return renderTreino();
  }
  if ((el = achar('[data-mais-bloco]'))) {
    serieDe(el.dataset.maisBloco).blocos.push(null);
    return renderTreino();
  }
  if ((el = achar('[data-menos-bloco]'))) {
    const s = serieDe(el.dataset.menosBloco);
    if (s.blocos.length > 1) s.blocos.pop();
    return renderTreino();
  }
  if ((el = achar('[data-backoff]'))) {
    const [ie, fracao] = el.dataset.backoff.split(':');
    const ex = sessao.exercicios[+ie];
    const s = novaSerie(ex.series[ex.series.length - 1]);
    s.kg = backoff(cargaDeTopo(ex.series), Number(fracao));
    ex.series.push(s);
    return renderTreino();
  }
  if ((el = achar('[data-mais-serie]'))) {
    const ex = sessao.exercicios[+el.dataset.maisSerie];
    ex.series.push(novaSerie(ex.series[ex.series.length - 1]));
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
    // A forma vem da última vez que ele fez o exercício (uma série, na primeira);
    // a carga, da última sessão desta ficha, que é a regra que ele pediu.
    const [ult, porFicha] = await Promise.all([
      db.ultimaVezDoExercicio(nome),
      db.cargasAnteriores(sessao.fichaId),
    ]);
    const antes = ult?.series?.length ? ult.series : [null];
    sessao.exercicios.push({
      nome,
      obs: '',
      series: antes.map((a) => {
        const s = novaSerie(a);
        if (porFicha[nome]) s.kg = porFicha[nome].kg;
        return s;
      }),
    });
    fecharFolha();
    return renderTreino();
  }

  if (achar('#abrirCardio')) return folhaCardio();
  if ((el = achar('#salvarCardio'))) return salvarCardio(Number(el.dataset.edita) || null);

  if ((el = achar('[data-mes]'))) return abrirMes(Number(el.dataset.mes));
  if (achar('#fecharMes')) { mesAberto = null; return $('#mesAmpliado').classList.remove('aberto'); }
  if ((el = achar('[data-abrir-dieta]'))) {
    mesAberto = null;
    $('#mesAmpliado').classList.remove('aberto');
    return abrirDiaDieta(el.dataset.abrirDieta);
  }
  if ((el = achar('[data-dia-dieta]'))) return abrirDiaDieta(el.dataset.diaDieta);
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
    diaDieta.refeicoes.push({ nome: el.dataset.refNome, itens: [], feita: true });
    fecharFolha();
    return salvarDiaDieta();
  }
  if (achar('#salvarRefeicao')) {
    const nome = $('#rNome').value.trim();
    if (!nome) return;
    // O que ele mesmo acrescenta já conta; só a dieta começa por marcar.
    diaDieta.refeicoes.push({ nome, itens: [], feita: true });
    fecharFolha();
    return salvarDiaDieta();
  }

  if ((el = achar('[data-add-refeicao]'))) return folhaAlimento(Number(el.dataset.addRefeicao));
  if ((el = achar('[data-alimento]'))) {
    const [iRef, ...resto] = el.dataset.alimento.split(':');
    return folhaPorcao(Number(iRef), resto.join(':'));
  }
  if ((el = achar('[data-confirma]'))) {
    const [iRef, ...resto] = el.dataset.confirma.split(':');
    const a = alimentos.find((x) => String(x.id) === resto.join(':'));
    const q = lerNumero($('#qtd').value);
    if (!a || !(q > 0)) return;
    const f = q / 100;
    diaDieta.refeicoes[Number(iRef)].itens.push({
      nome: a.nome, g_: q, kcal: a.kcal * f, p: a.p * f, c: a.c * f, g: a.g * f,
    });
    fecharFolha();
    return salvarDiaDieta();
  }
  if ((el = achar('[data-concluir]'))) {
    const r = diaDieta.refeicoes[Number(el.dataset.concluir)];
    r.feita = r.feita === false;
    return salvarDiaDieta();
  }
  if ((el = achar('[data-item]'))) {
    const [i, j] = el.dataset.item.split(':').map(Number);
    return folhaItem(i, j);
  }
  if ((el = achar('[data-salvar-item]'))) {
    const [i, j] = el.dataset.salvarItem.split(':').map(Number);
    const q = lerNumero($('#qtd').value);
    if (!(q > 0)) return;
    const itens = diaDieta.refeicoes[i].itens;
    itens[j] = comQuantidade(itens[j], q);
    fecharFolha();
    return salvarDiaDieta();
  }
  if ((el = achar('[data-remover]'))) {
    const [i, j] = el.dataset.remover.split(':').map(Number);
    diaDieta.refeicoes[i].itens.splice(j, 1);
    fecharFolha();
    return salvarDiaDieta();
  }
  if ((el = achar('[data-opcao]'))) {
    const [i, k] = el.dataset.opcao.split(':').map(Number);
    diaDieta.refeicoes[i].itens = plano.refeicoes[k].itens.map((x) => ({ ...x }));
    return salvarDiaDieta();
  }
  if ((el = achar('[data-voltar-plano]'))) {
    const r = diaDieta.refeicoes[Number(el.dataset.voltarPlano)];
    r.itens = plano.refeicoes.find((p) => p.nome === r.nome).itens.map((x) => ({ ...x }));
    return salvarDiaDieta();
  }
  if ((el = achar('[data-agua]'))) {
    diaDieta.agua = Math.max(0, (diaDieta.agua || 0) + Number(el.dataset.agua));
    return salvarDiaDieta();
  }
  if ((el = achar('[data-repetir]'))) return folhaRepetirSalva(Number(el.dataset.repetir));
  if ((el = achar('[data-usar-salva]'))) {
    const [iRef, id] = el.dataset.usarSalva.split(':');
    const s = salvas.find((x) => String(x.id) === id);
    if (s) diaDieta.refeicoes[Number(iRef)].itens.push(...s.itens.map((i) => ({ ...i })));
    fecharFolha();
    return salvarDiaDieta();
  }
  if ((el = achar('[data-salvar-ref]'))) return folhaSalvarRefeicao(Number(el.dataset.salvarRef));
  if ((el = achar('[data-confirma-salvar]'))) {
    const r = diaDieta.refeicoes[Number(el.dataset.confirmaSalvar)];
    await db.gravar(db.LOJAS.salvas, { nome: $('#sNome').value.trim() || r.nome, itens: r.itens.map((i) => ({ ...i })) });
    salvas = await db.todos(db.LOJAS.salvas);
    fecharFolha();
    return renderTudo();
  }
  if ((el = achar('[data-grade]'))) {
    gradeDe = el.dataset.grade;
    await db.salvarConfig('gradeDe', gradeDe);
    return renderPerfil();
  }

  if ((el = achar('[data-reg]'))) {
    fecharFolha();
    if (el.dataset.reg === 'treino') return sessao ? setTela('treino') : novaSessaoLivre();
    if (el.dataset.reg === 'ficha') return setTela('treino');
    if (el.dataset.reg === 'cardio') return folhaCardio();
    if (el.dataset.reg === 'perfil') { setTela('perfil'); return folhaPerfil(); }
    if (el.dataset.reg === 'refeicao') return setTela('dieta');
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-campo],[data-bloco],[data-obs]');
  if (!el || !sessao) return;

  if (el.dataset.obs != null) {
    sessao.exercicios[+el.dataset.obs].obs = el.value;
    return agendarGuardar();
  }

  // Digitar não redesenha a tela — o campo perderia o foco. Então o que é
  // calculado a partir do que ele digita se atualiza aqui, no lugar.
  const v = lerNumero(el.value);
  if (el.dataset.bloco) {
    const [ie, is, ib] = el.dataset.bloco.split(':').map(Number);
    const s = sessao.exercicios[ie].series[is];
    s.blocos[ib] = v;
    const soma = $(`#soma-${ie}-${is}`);
    if (soma) soma.textContent = virgula(somaBlocos(s.blocos)) || '—';
    return agendarGuardar();
  }

  const ie = +el.dataset.e;
  const ex = sessao.exercicios[ie];
  ex.series[+el.dataset.s][el.dataset.campo] = v;
  if (el.dataset.campo === 'kg') $(`#backoff-${ie}`).innerHTML = chipsBackoff(ex, ie);
  agendarGuardar();
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

// O iPhone pode acordar o app congelado de ontem, e a refeição de hoje cairia no
// dia anterior. Com treino aberto não recarrega: ele continua contando.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !sessao && chaveDia(new Date()) !== CHAVE_HOJE) location.reload();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
