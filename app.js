import { MESES, DIAS_SEMANA, chaveDia, diasDoMes, somaMacros } from './datas.js';

// =========================================================================
// PROTÓTIPO DA ETAPA 2 — dados fictícios, nada é salvo de verdade.
// O armazenamento em IndexedDB entra na etapa 3.
// =========================================================================

const HOJE = new Date();
const ANO = HOJE.getFullYear();
const CHAVE_HOJE = chaveDia(HOJE);

const perfil = { nome: 'Você', peso: 80 };

// Metas digitadas pelo usuário. O app nunca calcula nem sugere metas.
let metas = { kcal: 2400, p: 148, c: 333, g: 53 };

const FICHAS = {
  A: { titulo: 'Peito e tríceps', exercicios: [
    { nome: 'Supino reto com barra', ultima: [60, 10] },
    { nome: 'Supino inclinado com halteres', ultima: [24, 10] },
    { nome: 'Crucifixo na polia', ultima: [15, 12] },
    { nome: 'Tríceps na polia alta', ultima: [30, 12] },
    { nome: 'Tríceps testa', ultima: [25, 10] },
  ]},
  B: { titulo: 'Costas e bíceps', exercicios: [
    { nome: 'Barra fixa', ultima: [0, 8] },
    { nome: 'Remada curvada', ultima: [50, 10] },
    { nome: 'Puxada frente', ultima: [55, 10] },
    { nome: 'Rosca direta', ultima: [30, 10] },
    { nome: 'Rosca martelo', ultima: [14, 12] },
  ]},
  C: { titulo: 'Pernas e ombros', exercicios: [
    { nome: 'Agachamento livre', ultima: [80, 8] },
    { nome: 'Leg press', ultima: [140, 12] },
    { nome: 'Cadeira extensora', ultima: [45, 12] },
    { nome: 'Desenvolvimento com halteres', ultima: [18, 10] },
    { nome: 'Elevação lateral', ultima: [10, 15] },
  ]},
};

let ALIMENTOS = [
  { nome: 'Ovo, de galinha, cozido', kcal: 146, p: 13.3, c: 0.6, g: 9.5 },
  { nome: 'Arroz, integral, cozido', kcal: 124, p: 2.6, c: 25.8, g: 1.0 },
  { nome: 'Feijão, carioca, cozido', kcal: 76, p: 4.8, c: 13.6, g: 0.5 },
  { nome: 'Frango, peito, grelhado', kcal: 159, p: 32.0, c: 0, g: 2.5 },
  { nome: 'Pão, francês', kcal: 300, p: 8.0, c: 58.6, g: 3.1 },
  { nome: 'Banana, prata', kcal: 98, p: 1.3, c: 26.0, g: 0.1 },
  { nome: 'Batata, doce, cozida', kcal: 77, p: 0.6, c: 18.4, g: 0.1 },
  { nome: 'Whey, concentrado', kcal: 400, p: 80.0, c: 8.0, g: 6.0 },
  { nome: 'Aveia, em flocos', kcal: 394, p: 13.9, c: 66.6, g: 8.5 },
  { nome: 'Azeite, de oliva', kcal: 884, p: 0, c: 0, g: 100 },
];

// --- histórico fictício do ano, gerado de forma determinística ---
const treinos = new Map();
const kcalPorDia = new Map();
(function semear() {
  const letras = ['A', 'B', 'C'];
  let i = 0;
  for (let d = new Date(ANO, 0, 1); d <= HOJE; d.setDate(d.getDate() + 1)) {
    const semana = d.getDay();
    const dia = d.getDate();
    const faltou = (dia * 31 + d.getMonth() * 17) % 9 === 0;
    kcalPorDia.set(chaveDia(d), 1900 + ((dia * 53 + d.getMonth() * 29) % 700));
    if (![1, 3, 5, 6].includes(semana) || faltou) continue;
    const letra = letras[i++ % 3];
    treinos.set(chaveDia(d), {
      ficha: letra,
      titulo: FICHAS[letra].titulo,
      exercicios: FICHAS[letra].exercicios.length,
      minutos: 48 + (dia % 5) * 6,
    });
  }
})();

const refeicoes = [
  { nome: 'Café da manhã', hora: '07:20', itens: [
    { nome: 'Ovo, de galinha, cozido', g: 120, kcal: 175, p: 16, c: 0.7, g_: 11.4 },
    { nome: 'Pão, francês', g: 50, kcal: 150, p: 4, c: 29.3, g_: 1.6 },
  ]},
  { nome: 'Almoço', hora: '12:40', itens: [
    { nome: 'Arroz, integral, cozido', g: 180, kcal: 223, p: 4.7, c: 46.4, g_: 1.8 },
    { nome: 'Feijão, carioca, cozido', g: 140, kcal: 106, p: 6.7, c: 19, g_: 0.7 },
    { nome: 'Frango, peito, grelhado', g: 180, kcal: 286, p: 57.6, c: 0, g_: 4.5 },
  ]},
  { nome: 'Lanche', hora: '16:10', itens: [
    { nome: 'Whey, concentrado', g: 30, kcal: 120, p: 24, c: 2.4, g_: 1.8 },
    { nome: 'Banana, prata', g: 100, kcal: 98, p: 1.3, c: 26, g_: 0.1 },
  ]},
  { nome: 'Jantar', hora: '20:30', itens: [] },
];

// --- estado da interface ---
let telaAtual = 'hoje';
let sessao = null;        // sessão de treino em andamento
let diaSelecionado = null;
let mesAberto = null;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

function macrosDoDia() {
  return somaMacros(refeicoes.flatMap((r) => r.itens.map((i) => ({ kcal: i.kcal, p: i.p, c: i.c, g: i.g_ }))));
}

// =========================================================================
// Telas
// =========================================================================

function renderHoje() {
  const t = treinos.get(CHAVE_HOJE);
  const m = macrosDoDia();
  const dataLonga = HOJE.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  $('#tela-hoje').innerHTML = `
    <header class="topo">
      <h1>Hoje</h1>
      <div class="data">${esc(dataLonga)}</div>
    </header>

    <div class="card">
      <h2>Treino</h2>
      ${t
        ? `<div class="linha-item"><div><div>Ficha ${t.ficha} — ${esc(t.titulo)}</div>
             <div class="sub">${t.exercicios} exercícios · ${t.minutos} min</div></div>
             <div class="destaque">✓</div></div>`
        : `<div class="vazio">Nada registrado hoje.</div>
           <button class="botao" data-ir="treino">Registrar treino</button>`}
    </div>

    <div class="card">
      <h2>Dieta</h2>
      <div class="linha-item"><div>Calorias</div>
        <div><span class="destaque">${m.kcal.toFixed(0)}</span> <span class="sub">/ ${metas.kcal} kcal</span></div></div>
      ${barra('Proteína', m.p, metas.p)}
      ${barra('Carboidrato', m.c, metas.c)}
      ${barra('Gordura', m.g, metas.g)}
    </div>

    <div class="card">
      <h2>Este mês</h2>
      <div class="linha-item">
        <div><div class="num-grande destaque">${contaMes(HOJE.getMonth())}</div>
          <div class="sub" style="margin-top:6px">dias treinados em ${MESES[HOJE.getMonth()].toLowerCase()}</div></div>
      </div>
    </div>`;
}

function barra(rotulo, valor, meta) {
  const pct = meta ? Math.min(100, (valor / meta) * 100) : 0;
  return `<div class="macro">
    <div class="rot"><span>${rotulo}</span><span class="sub">${n1(valor)} / ${meta} g</span></div>
    <div class="trilho"><i style="width:${pct}%"></i></div></div>`;
}

function renderTreino() {
  const el = $('#tela-treino');

  if (!sessao) {
    el.innerHTML = `
      <header class="topo"><h1>Treino</h1><div class="data">Escolha uma ficha</div></header>
      ${Object.entries(FICHAS).map(([letra, f]) => `
        <button class="card" style="display:block;width:100%;text-align:left" data-ficha="${letra}">
          <div class="linha-item">
            <div><div style="font-weight:600">Ficha ${letra}</div>
              <div class="sub">${esc(f.titulo)} · ${f.exercicios.length} exercícios</div></div>
            <div class="sub">›</div>
          </div>
        </button>`).join('')}
      <div class="card">
        <h2>Últimos treinos</h2>
        ${ultimosTreinos(5)}
      </div>`;
    return;
  }

  const feitas = sessao.exercicios.flatMap((e) => e.series).filter((s) => s.feita).length;
  const total = sessao.exercicios.flatMap((e) => e.series).length;

  el.innerHTML = `
    <header class="topo">
      <h1>Ficha ${sessao.ficha}</h1>
      <div class="data">${esc(FICHAS[sessao.ficha].titulo)} · ${feitas} de ${total} séries</div>
    </header>
    ${sessao.exercicios.map((ex, ie) => `
      <div class="card">
        <h2>${esc(ex.nome)}</h2>
        <div class="serie-cab"><span></span><span>kg</span><span>reps</span><span></span></div>
        ${ex.series.map((s, is) => `
          <div class="serie ${s.feita ? 'feita' : ''}">
            <span class="idx">${is + 1}</span>
            <input type="number" inputmode="decimal" value="${s.kg}" data-campo="kg" data-e="${ie}" data-s="${is}">
            <input type="number" inputmode="numeric" value="${s.reps}" data-campo="reps" data-e="${ie}" data-s="${is}">
            <button class="ok" data-feita="${ie}:${is}">✓</button>
          </div>`).join('')}
      </div>`).join('')}
    <button class="botao" id="finalizar">Finalizar treino</button>
    <button class="botao fraco" id="cancelar">Cancelar</button>`;
}

function ultimosTreinos(qtd) {
  const chaves = [...treinos.keys()].sort().reverse().slice(0, qtd);
  if (!chaves.length) return '<div class="vazio">Nenhum treino registrado.</div>';
  return chaves.map((k) => {
    const t = treinos.get(k);
    const [a, m, d] = k.split('-');
    return `<div class="linha-item">
      <div><div>Ficha ${t.ficha} — ${esc(t.titulo)}</div><div class="sub">${t.minutos} min</div></div>
      <div class="sub">${d}/${m}</div></div>`;
  }).join('');
}

function renderDieta() {
  const m = macrosDoDia();
  $('#tela-dieta').innerHTML = `
    <header class="topo"><h1>Dieta</h1><div class="data">Hoje</div></header>

    <div class="card">
      <div class="linha-item">
        <div><div class="num-grande">${m.kcal.toFixed(0)}</div>
          <div class="sub" style="margin-top:6px">de ${metas.kcal} kcal que você definiu</div></div>
        <button class="sub" id="editarMetas">editar</button>
      </div>
      ${barra('Proteína', m.p, metas.p)}
      ${barra('Carboidrato', m.c, metas.c)}
      ${barra('Gordura', m.g, metas.g)}
    </div>

    ${refeicoes.map((r, i) => {
      const s = somaMacros(r.itens.map((x) => ({ kcal: x.kcal, p: x.p, c: x.c, g: x.g_ })));
      return `<div class="card">
        <h2>${esc(r.nome)} · ${r.hora}</h2>
        ${r.itens.length
          ? r.itens.map((it) => `<div class="linha-item">
              <div><div>${esc(it.nome)}</div><div class="sub">${it.g} g</div></div>
              <div class="sub">${it.kcal.toFixed(0)} kcal</div></div>`).join('')
          : '<div class="vazio">Nada registrado.</div>'}
        <div class="linha-item" style="border-top:1px solid var(--linha);margin-top:8px;padding-top:11px">
          <button class="destaque" data-add-refeicao="${i}">+ Adicionar alimento</button>
          <div class="sub" style="white-space:nowrap">${s.kcal.toFixed(0)} kcal · P ${s.p.toFixed(0)} C ${s.c.toFixed(0)} G ${s.g.toFixed(0)}</div>
        </div>
      </div>`;
    }).join('')}`;
}

function renderPerfil() {
  const total = [...treinos.keys()].filter((k) => k.startsWith(ANO)).length;
  const cores = ['#e5342b', '#ff7a1a', '#f5c518', '#28c76f', '#2f9bff', '#a855f7'];
  const atual = getComputedStyle(document.documentElement).getPropertyValue('--cor').trim();

  $('#tela-perfil').innerHTML = `
    <div class="perfil-topo">
      <div class="avatar">🗿</div>
      <div><div class="nome">${esc(perfil.nome)}</div><div class="sub">${perfil.peso} kg</div></div>
      <div class="cores">${cores.map((c) => `
        <button data-cor="${c}" style="background:${c}" class="${c === atual ? 'sel' : ''}"></button>`).join('')}</div>
    </div>

    <div class="card">
      <div class="ano-cabeca">
        <span class="ano">${ANO} ›</span>
        <span><span class="num-grande destaque">${total}</span> <span class="sub">dias</span></span>
      </div>
      <div class="meses">${MESES.map((_, i) => mesMini(i)).join('')}</div>
    </div>

    <div class="card">
      <h2>Toque num mês</h2>
      <div class="sub">Abre o calendário ampliado com os dias numerados e o que foi registrado em cada um.</div>
    </div>`;
}

function contaMes(mes) {
  const pre = `${ANO}-${String(mes + 1).padStart(2, '0')}`;
  return [...treinos.keys()].filter((k) => k.startsWith(pre)).length;
}

function mesMini(mes) {
  const { vazios, total } = diasDoMes(ANO, mes);
  const futuro = mes > HOJE.getMonth();
  let quadrados = '<span class="d off"></span>'.repeat(vazios);
  for (let d = 1; d <= total; d++) {
    const k = `${ANO}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const classes = ['d', treinos.has(k) ? 'on' : '', k === CHAVE_HOJE ? 'hoje' : ''].filter(Boolean).join(' ');
    quadrados += `<span class="${classes}"></span>`;
  }
  return `<button class="mes ${mes === HOJE.getMonth() ? 'atual' : ''} ${futuro ? 'futuro' : ''}" data-mes="${mes}">
    <div class="nome"><span>${MESES[mes].slice(0, 3)}</span><span>${contaMes(mes) || ''}</span></div>
    <div class="dias">${quadrados}</div>
  </button>`;
}

// =========================================================================
// Mês ampliado
// =========================================================================

function abrirMes(mes) {
  mesAberto = mes;
  diaSelecionado = null;
  renderMesAmpliado();
  $('#mesAmpliado').classList.add('aberto');
}

function renderMesAmpliado() {
  const mes = mesAberto;
  const { vazios, total } = diasDoMes(ANO, mes);
  let celulas = '<button class="espaco"></button>'.repeat(vazios);
  for (let d = 1; d <= total; d++) {
    const k = `${ANO}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const classes = [treinos.has(k) ? 'on' : '', k === CHAVE_HOJE ? 'hoje' : '', k === diaSelecionado ? 'sel' : ''].filter(Boolean).join(' ');
    celulas += `<button class="${classes}" data-dia="${k}">${d}</button>`;
  }

  $('#mesAmpliado').innerHTML = `
    <div class="amp-topo">
      <button class="voltar" id="fecharMes">‹</button>
      <h2>${MESES[mes]} de ${ANO}</h2>
      <span class="sub" style="margin-left:auto">${contaMes(mes)} dias</span>
    </div>
    <div class="semana">${DIAS_SEMANA.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal">${celulas}</div>
    <div class="card" style="margin-top:20px">${detalheDia()}</div>`;
}

function detalheDia() {
  if (!diaSelecionado) return '<div class="vazio">Toque num dia para ver o que foi registrado.</div>';
  const [a, m, d] = diaSelecionado.split('-');
  const t = treinos.get(diaSelecionado);
  const kcal = kcalPorDia.get(diaSelecionado);
  return `<h2>${d} de ${MESES[+m - 1].toLowerCase()}</h2>
    ${t
      ? `<div class="linha-item"><div><div>Ficha ${t.ficha} — ${esc(t.titulo)}</div>
          <div class="sub">${t.exercicios} exercícios · ${t.minutos} min</div></div><div class="destaque">✓</div></div>`
      : '<div class="linha-item"><div class="sub">Sem treino.</div></div>'}
    ${kcal
      ? `<div class="linha-item"><div>Dieta</div><div class="sub">${kcal} kcal</div></div>`
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

function folhaRegistro() {
  abrirFolha(`<h3>Registrar</h3>
    <button class="opcao" data-reg="treino"><span class="bolha">🏋️</span><div><div>Treino</div><div class="sub">Abrir uma ficha</div></div></button>
    <button class="opcao" data-reg="refeicao"><span class="bolha">🍽️</span><div><div>Refeição</div><div class="sub">Adicionar alimento</div></div></button>
    <button class="opcao" data-reg="peso"><span class="bolha">⚖️</span><div><div>Peso</div><div class="sub">Atual: ${perfil.peso} kg</div></div></button>`);
}

function folhaAlimento(indiceRefeicao) {
  abrirFolha(`<h3>Adicionar em ${esc(refeicoes[indiceRefeicao].nome)}</h3>
    <input class="busca" id="buscaAlimento" placeholder="Buscar alimento" autocomplete="off">
    <div id="resultados"></div>`);
  const lista = () => {
    const q = $('#buscaAlimento').value.toLowerCase();
    const achados = ALIMENTOS.filter((a) => a.nome.toLowerCase().includes(q)).slice(0, 8);
    $('#resultados').innerHTML = achados.length
      ? achados.map((a, i) => `<button class="opcao" data-alimento="${indiceRefeicao}:${ALIMENTOS.indexOf(a)}">
          <div><div>${esc(a.nome)}</div><div class="sub">${a.kcal} kcal · P ${n1(a.p)} C ${n1(a.c)} G ${n1(a.g)} por 100 g</div></div></button>`).join('')
      : '<div class="vazio">Nenhum alimento encontrado.</div>';
  };
  lista();
  $('#buscaAlimento').addEventListener('input', lista);
}

function folhaPorcao(iRef, iAli) {
  const a = ALIMENTOS[iAli];
  abrirFolha(`<h3>${esc(a.nome)}</h3>
    <input class="busca" id="qtd" type="number" inputmode="decimal" value="100">
    <div class="sub" style="margin-bottom:14px">gramas</div>
    <button class="botao" data-confirma="${iRef}:${iAli}">Adicionar</button>`);
}

function folhaPeso() {
  abrirFolha(`<h3>Peso</h3>
    <input class="busca" id="novoPeso" type="number" inputmode="decimal" value="${perfil.peso}">
    <div class="sub" style="margin-bottom:14px">kg</div>
    <button class="botao" id="salvarPeso">Salvar</button>`);
}

function folhaMetas() {
  abrirFolha(`<h3>Suas metas</h3>
    <div class="sub" style="margin-bottom:14px">O app não calcula metas. Os valores são os que você digitar.</div>
    ${[['kcal', 'Calorias (kcal)'], ['p', 'Proteína (g)'], ['c', 'Carboidrato (g)'], ['g', 'Gordura (g)']]
      .map(([k, r]) => `<div class="sub" style="margin-bottom:4px">${r}</div>
        <input class="busca" type="number" inputmode="decimal" data-meta="${k}" value="${metas[k]}">`).join('')}
    <button class="botao" id="salvarMetas">Salvar</button>`);
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
  renderHoje();
  renderTreino();
  renderDieta();
  renderPerfil();
  if (mesAberto !== null) renderMesAmpliado();
}

document.addEventListener('click', (ev) => {
  const alvo = (sel) => ev.target.closest(sel);
  let el;

  if ((el = alvo('.aba'))) return setTela(el.dataset.tela);
  if (alvo('#fab')) return folhaRegistro();
  if ((el = alvo('[data-ir]'))) return setTela(el.dataset.ir);

  // ficha escolhida -> começa a sessão
  if ((el = alvo('[data-ficha]'))) {
    const letra = el.dataset.ficha;
    sessao = {
      ficha: letra,
      exercicios: FICHAS[letra].exercicios.map((e) => ({
        nome: e.nome,
        series: [0, 1, 2].map(() => ({ kg: e.ultima[0], reps: e.ultima[1], feita: false })),
      })),
    };
    return renderTreino();
  }

  if ((el = alvo('[data-feita]'))) {
    const [ie, is] = el.dataset.feita.split(':').map(Number);
    const s = sessao.exercicios[ie].series[is];
    s.feita = !s.feita;
    return renderTreino();
  }

  if (alvo('#finalizar')) {
    const feitas = sessao.exercicios.flatMap((e) => e.series).filter((s) => s.feita).length;
    treinos.set(CHAVE_HOJE, {
      ficha: sessao.ficha,
      titulo: FICHAS[sessao.ficha].titulo,
      exercicios: sessao.exercicios.length,
      minutos: Math.max(20, feitas * 4),
    });
    sessao = null;
    setTela('perfil');
    return;
  }
  if (alvo('#cancelar')) { sessao = null; return renderTreino(); }

  if ((el = alvo('[data-mes]'))) return abrirMes(Number(el.dataset.mes));
  if (alvo('#fecharMes')) { mesAberto = null; return $('#mesAmpliado').classList.remove('aberto'); }
  if ((el = alvo('[data-dia]'))) { diaSelecionado = el.dataset.dia; return renderMesAmpliado(); }

  if ((el = alvo('[data-cor]'))) {
    document.documentElement.style.setProperty('--cor', el.dataset.cor);
    try { localStorage.setItem('cor', el.dataset.cor); } catch {}
    return renderPerfil();
  }

  if ((el = alvo('[data-add-refeicao]'))) return folhaAlimento(Number(el.dataset.addRefeicao));
  if ((el = alvo('[data-alimento]'))) {
    const [iRef, iAli] = el.dataset.alimento.split(':').map(Number);
    return folhaPorcao(iRef, iAli);
  }
  if ((el = alvo('[data-confirma]'))) {
    const [iRef, iAli] = el.dataset.confirma.split(':').map(Number);
    const a = ALIMENTOS[iAli];
    const q = Number($('#qtd').value) || 0;
    const f = q / 100;
    refeicoes[iRef].itens.push({ nome: a.nome, g: q, kcal: a.kcal * f, p: a.p * f, c: a.c * f, g_: a.g * f });
    fecharFolha();
    setTela('dieta');
    return;
  }

  if (alvo('#editarMetas')) return folhaMetas();
  if (alvo('#salvarMetas')) {
    document.querySelectorAll('[data-meta]').forEach((i) => { metas[i.dataset.meta] = Number(i.value) || 0; });
    fecharFolha();
    return renderTudo();
  }

  if (alvo('#salvarPeso')) {
    perfil.peso = Number($('#novoPeso').value) || perfil.peso;
    fecharFolha();
    return renderTudo();
  }

  if ((el = alvo('[data-reg]'))) {
    fecharFolha();
    if (el.dataset.reg === 'treino') return setTela('treino');
    if (el.dataset.reg === 'refeicao') { setTela('dieta'); return folhaAlimento(0); }
    if (el.dataset.reg === 'peso') return folhaPeso();
  }

  if (ev.target.id === 'folhaFundo') return fecharFolha();
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-campo]');
  if (!el || !sessao) return;
  sessao.exercicios[+el.dataset.e].series[+el.dataset.s][el.dataset.campo] = Number(el.value);
});

// =========================================================================
// Início
// =========================================================================

try {
  const cor = localStorage.getItem('cor');
  if (cor) document.documentElement.style.setProperty('--cor', cor);
} catch {}

// Se o Gemini já tiver gerado a tabela TACO, o protótipo passa a usá-la.
fetch('dados/taco.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((taco) => {
    if (!Array.isArray(taco) || !taco.length) return;
    ALIMENTOS = taco.map((a) => ({
      nome: a.nome,
      kcal: a.por100g?.kcal ?? 0,
      p: a.por100g?.proteina ?? 0,
      c: a.por100g?.carboidrato ?? 0,
      g: a.por100g?.gordura ?? 0,
    }));
  })
  .catch(() => {});

renderTudo();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
