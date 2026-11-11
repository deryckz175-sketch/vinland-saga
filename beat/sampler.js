// Samplear: abre uma música (MP3, M4A, WAV…) ou uma gravação de áudio, mostra
// a onda, deixa escolher um trecho e põe esse trecho num pad.
//
// Jeitos de escolher o trecho:
//   - arrastar na onda de cima (música inteira) ou nas alças da de baixo (zoom);
//   - tocar a música e apertar "Marcar início" / "Marcar fim" na hora certa;
//   - os botões − e + ajustam de 10 em 10 ms.

import { cortarTrecho } from './wav.js';
import * as db from './db.js';

const MIN = 0.03;   // trecho mais curto (s)
const MAX = 30;     // trecho mais longo (s)
const MAX_MUSICA = 20 * 60;
const RECENTES = 6;
const PASSO = 0.01;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

export function tempoTexto(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0').replace('.', ',')}`;
}

let D = null;
let aberto = false;
const S = {
  musica: null,   // { nome, buf, dur, ch: [l, r], taxa }
  ini: 0,
  fim: 1,
  janela: [0, 1],
  play: null,     // { src, t, a, b, tipo }
  arraste: null,
  pacote: null,
  banco: 0,
  destino: null,  // { pacote, pad } quando veio do editor de um pad
  desfazer: null, // [{ pacote, pad, anterior }]
  contador: 0,
  picosGeral: null,
  picosZoom: null,
};

export function configurarSampler(deps) {
  D = deps;
  $('smFechar').addEventListener('click', fecharSampler);
  $('smArquivo').addEventListener('change', () => {
    const f = $('smArquivo').files && $('smArquivo').files[0];
    $('smArquivo').value = '';
    if (f) carregarFonte({ tipo: 'arquivo', arquivo: f });
  });
  window.addEventListener('resize', () => { if (aberto && S.musica) { medirCanvas(); desenhar(); } });
}

export const samplerAberto = () => aberto;

export async function abrirSampler({ fonte = null, destino = null } = {}) {
  D.pararOutros();
  S.destino = destino;
  S.pacote = destino ? destino.pacote : D.pacote();
  S.banco = destino ? Math.floor(destino.pad / 16) : D.banco();
  S.desfazer = null;
  aberto = true;
  $('sampler').classList.add('aberto');
  $('smCorpo').scrollTop = 0;
  if (fonte) await carregarFonte(fonte);
  else if (S.musica) renderEditor();
  else renderInicio();
}

export function fecharSampler() {
  if (!aberto) return;
  pararPlay();
  aberto = false;
  S.desfazer = null;
  $('sampler').classList.remove('aberto');
  D.aoFechar();
}

// ------------------------------------------------------------------ início
async function renderInicio() {
  pararPlay();
  $('smTitulo').textContent = 'Samplear';
  $('smCorpo').innerHTML = `
    <p class="sub" style="margin:4px 0 16px">Escolha uma música (MP3, M4A, WAV…) do app Arquivos. Depois marque o trecho e toque num pad para colocar ele ali.</p>
    <button class="botao primario" id="smEscolher">📁 Escolher música</button>
    <div id="smRecentes"></div>`;
  $('smEscolher').addEventListener('click', () => $('smArquivo').click());
  let musicas = [];
  let audios = [];
  try {
    musicas = (await db.listar(db.MUSICAS)).sort((a, b) => b.criada - a.criada);
    audios = (await db.listar(db.GRAVACOES)).filter((g) => g.tipo === 'audio').sort((a, b) => b.criada - a.criada);
  } catch {}
  if (!aberto || !$('smRecentes')) return;
  const linha = (tipo, id, nome, dur) => `
    <div class="sm-item">
      <button class="sm-abrir" data-tipo="${tipo}" data-id="${id}"><b>${esc(nome)}</b><small>${tempoTexto(dur || 0).replace(/,\d+$/, '')}</small></button>
      ${tipo === 'musica' ? `<button class="sm-tirar" data-tirar="${id}" aria-label="Tirar da lista">✕</button>` : ''}
    </div>`;
  let html = '';
  if (musicas.length) html += `<div class="card" style="margin-top:14px"><h2>Músicas recentes</h2>${musicas.map((m) => linha('musica', m.id, m.nome, m.dur)).join('')}</div>`;
  if (audios.length) html += `<div class="card"><h2>Seus áudios gravados</h2>${audios.map((g) => linha('audio', g.id, g.nome, g.dur)).join('')}</div>`;
  $('smRecentes').innerHTML = html;
  const porId = new Map(audios.map((g) => [g.id, g]));
  $('smRecentes').querySelectorAll('.sm-abrir').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.id);
    if (b.dataset.tipo === 'musica') carregarFonte({ tipo: 'musica', id });
    else carregarFonte({ tipo: 'gravacao', reg: porId.get(id) });
  }));
  $('smRecentes').querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', async () => {
    try { await db.apagar(db.MUSICAS, Number(b.dataset.tirar)); } catch {}
    renderInicio();
  }));
}

async function guardarRecente(nome, dados, dur) {
  try {
    const lista = (await db.listar(db.MUSICAS)).sort((a, b) => b.criada - a.criada);
    const igual = lista.find((m) => m.nome === nome && m.dados.byteLength === dados.byteLength);
    if (igual) { igual.criada = Date.now(); await db.salvar(db.MUSICAS, igual); return; }
    await db.salvar(db.MUSICAS, { nome, dados, dur, criada: Date.now() });
    for (const m of lista.slice(RECENTES - 1)) await db.apagar(db.MUSICAS, m.id);
  } catch {} // sem espaço: só não guarda nos recentes
}

async function carregarFonte(fonte) {
  pararPlay();
  $('smCorpo').innerHTML = '<div class="vazio">Abrindo…</div>';
  try {
    let nome;
    let dados;
    if (fonte.tipo === 'arquivo') {
      nome = fonte.arquivo.name.replace(/\.[^.]+$/, '') || 'Música';
      dados = await fonte.arquivo.arrayBuffer();
    } else if (fonte.tipo === 'musica') {
      const reg = await db.pegar(db.MUSICAS, fonte.id);
      if (!reg) throw new Error('não achei');
      nome = reg.nome;
      dados = reg.dados;
      reg.criada = Date.now();
      db.salvar(db.MUSICAS, reg).catch(() => {});
    } else {
      nome = fonte.reg.nome;
      dados = fonte.reg.wav;
    }
    D.audio();
    const buf = await D.decodificar(dados.slice(0));
    if (buf.duration > MAX_MUSICA) throw new Error('música com mais de 20 minutos');
    if (fonte.tipo === 'arquivo') guardarRecente(nome, dados, buf.duration);
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    S.musica = { nome, buf, dur: buf.duration, ch: [l, r], taxa: buf.sampleRate };
    S.ini = 0;
    S.fim = Math.min(buf.duration, 2);
    S.picosGeral = null;
    centrarJanela();
    renderEditor();
  } catch (e) {
    D.aviso(`Não consegui abrir: ${e?.message || 'formato não suportado'}`, 3000);
    renderInicio();
  }
}

// ------------------------------------------------------------------ editor
function nomeCurto() {
  return S.musica.nome.length > 12 ? `${S.musica.nome.slice(0, 11).trim()}…` : S.musica.nome;
}

function renderEditor() {
  const m = S.musica;
  $('smTitulo').textContent = 'Samplear';
  const dest = S.destino;
  $('smCorpo').innerHTML = `
    <div class="sm-nome"><b>${esc(m.nome)}</b><span>${tempoTexto(m.dur)}</span></div>
    <canvas id="smGeral" class="sm-onda geral" aria-label="Música inteira"></canvas>
    <canvas id="smZoom" class="sm-onda zoom" aria-label="Trecho ampliado"></canvas>
    <div class="sm-tempos">
      <div class="sm-t"><small>Início</small><b id="smIni"></b>
        <div class="sm-mm"><button data-mexer="ini" data-d="-1" aria-label="Início antes">−</button><button data-mexer="ini" data-d="1" aria-label="Início depois">+</button></div></div>
      <div class="sm-t meio"><small>Trecho</small><b id="smDur"></b></div>
      <div class="sm-t"><small>Fim</small><b id="smFim"></b>
        <div class="sm-mm"><button data-mexer="fim" data-d="-1" aria-label="Fim antes">−</button><button data-mexer="fim" data-d="1" aria-label="Fim depois">+</button></div></div>
    </div>
    <div class="sm-linha">
      <button class="botao primario" id="smOuvir"></button>
      <button class="botao" id="smMusica"></button>
    </div>
    <div class="sm-linha">
      <button class="botao" id="smMarcaIni">⟦ Marcar início</button>
      <button class="botao" id="smMarcaFim">Marcar fim ⟧</button>
    </div>
    <div class="sm-linha">
      <button class="botao" id="smAnterior">⇤ Anterior</button>
      <button class="botao" id="smProximo">Próximo ⇥</button>
    </div>
    ${dest ? `<button class="botao primario" id="smNoDestino" style="margin-top:12px">Colocar no pad ${(dest.pad % 16) + 1} e voltar</button>` : ''}
    <div class="card" style="margin-top:14px">
      <h2>Toque num pad para colocar o trecho</h2>
      <div class="chips" style="margin-bottom:10px">
        <button class="chip" data-banco="0">● Banco 1</button><button class="chip" data-banco="1">○ Banco 2</button>
      </div>
      <div class="sm-pads" id="smPads"></div>
      <button class="botao" id="smDesfazer" style="margin-top:10px" hidden>↶ Desfazer</button>
    </div>
    <div class="card">
      <h2>Fatiar o trecho</h2>
      <p class="sub" style="margin:0 0 10px">Divide o trecho em partes iguais e coloca nos primeiros pads do banco escolhido acima.</p>
      <div class="chips"><button class="chip" data-fatias="4">4 pads</button><button class="chip" data-fatias="8">8 pads</button><button class="chip" data-fatias="16">16 pads</button></div>
    </div>
    <button class="botao" id="smTrocar">Trocar música</button>`;

  medirCanvas();
  ligarOnda($('smGeral'), 'geral');
  ligarOnda($('smZoom'), 'zoom');
  $('smCorpo').querySelectorAll('[data-mexer]').forEach((b) => b.addEventListener('click', () => {
    mexer(b.dataset.mexer, Number(b.dataset.d) * PASSO);
  }));
  $('smOuvir').addEventListener('click', () => {
    if (S.play && S.play.tipo === 'trecho') pararPlay();
    else tocar(S.ini, S.fim, 'trecho');
  });
  $('smMusica').addEventListener('click', () => {
    if (S.play && S.play.tipo === 'musica') pararPlay();
    else tocar(S.ini, S.musica.dur, 'musica');
  });
  $('smMarcaIni').addEventListener('click', marcarInicio);
  $('smMarcaFim').addEventListener('click', marcarFim);
  $('smAnterior').addEventListener('click', () => andar(-1));
  $('smProximo').addEventListener('click', () => andar(1));
  $('smNoDestino')?.addEventListener('click', async () => {
    const { pacote, pad } = S.destino;
    const ok = await colocar([{ pacote, pad, a: S.ini, b: S.fim }]);
    if (!ok) return;
    S.desfazer = null; // já confirmou: sai daqui
    fecharSampler();
    D.voltarAoEditor(pacote, pad);
  });
  $('smCorpo').querySelectorAll('[data-banco]').forEach((b) => b.addEventListener('click', () => {
    S.banco = Number(b.dataset.banco);
    renderPads();
  }));
  $('smDesfazer').addEventListener('click', desfazer);
  $('smCorpo').querySelectorAll('[data-fatias]').forEach((b) => fatiarComConfirmacao(b));
  $('smTrocar').addEventListener('click', renderInicio);
  renderPads();
  atualizar();
}

function renderPads() {
  $('smCorpo').querySelectorAll('[data-banco]').forEach((b) => b.classList.toggle('on', Number(b.dataset.banco) === S.banco));
  const grade = $('smPads');
  grade.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const pad = S.banco * 16 + i;
    const b = document.createElement('button');
    b.className = 'sm-pad';
    if (S.destino && S.destino.pacote === S.pacote && S.destino.pad === pad) b.classList.add('destino');
    if (D.temAmostra(S.pacote, pad)) b.classList.add('amostra');
    b.innerHTML = `<span>${i + 1}</span><small>${esc(D.nomeDoPad(S.pacote, pad))}</small>`;
    b.addEventListener('click', () => colocar([{ pacote: S.pacote, pad, a: S.ini, b: S.fim }], b));
    grade.appendChild(b);
  }
}

function fatiarComConfirmacao(btn) {
  const original = btn.textContent;
  let armado = false;
  let tm = null;
  btn.addEventListener('click', () => {
    const n = Number(btn.dataset.fatias);
    if (!armado) {
      armado = true;
      btn.textContent = `Substituir pads 1–${n}?`;
      tm = setTimeout(() => { armado = false; btn.textContent = original; }, 3000);
      return;
    }
    clearTimeout(tm);
    armado = false;
    btn.textContent = original;
    const parte = (S.fim - S.ini) / n;
    if (parte < MIN) { D.aviso('Trecho curto demais para tantas fatias'); return; }
    const lista = [];
    for (let i = 0; i < n; i++) lista.push({ pacote: S.pacote, pad: S.banco * 16 + i, a: S.ini + i * parte, b: S.ini + (i + 1) * parte });
    colocar(lista);
  });
}

async function colocar(lista, botao) {
  const m = S.musica;
  const desfazer = [];
  try {
    for (const it of lista) {
      S.contador += 1;
      const canais = cortarTrecho(m.ch, m.taxa, it.a, it.b);
      const anterior = await D.colocarNoPad(canais, m.taxa, `${nomeCurto()} ${S.contador}`, it.pacote, it.pad);
      desfazer.push({ pacote: it.pacote, pad: it.pad, anterior });
    }
  } catch (e) {
    D.aviso(`Não consegui colocar: ${e?.message || e}`);
    return false;
  }
  S.desfazer = desfazer;
  pararPlay();
  if (lista.length === 1) {
    D.tocarPad(lista[0].pacote, lista[0].pad);
    D.aviso(`Trecho no pad ${(lista[0].pad % 16) + 1}`);
  } else {
    D.aviso(`${lista.length} fatias nos pads 1–${lista.length}`);
  }
  if ($('smPads')) {
    renderPads();
    if (botao) {
      const novo = $('smPads').children[lista[0].pad % 16];
      novo.classList.add('aceso');
    }
    $('smDesfazer').hidden = false;
  }
  return true;
}

function desfazer() {
  if (!S.desfazer) return;
  for (const d of [...S.desfazer].reverse()) D.restaurarPad(d.pacote, d.pad, d.anterior);
  S.desfazer = null;
  $('smDesfazer').hidden = true;
  renderPads();
  D.aviso('Desfeito');
}

// ------------------------------------------------------------------ seleção
function centrarJanela() {
  const m = S.musica;
  const folga = Math.max(0.1, (S.fim - S.ini) * 0.3);
  S.janela = [Math.max(0, S.ini - folga), Math.min(m.dur, S.fim + folga)];
  S.picosZoom = null;
}

function definir(ini, fim, { tocarDepois = false } = {}) {
  const dur = S.musica.dur;
  ini = limitar(ini, 0, Math.max(0, dur - MIN));
  fim = limitar(fim, ini + MIN, Math.min(dur, ini + MAX));
  S.ini = ini;
  S.fim = fim;
  centrarJanela();
  atualizar();
  if (tocarDepois && !(S.play && S.play.tipo === 'musica')) tocar(S.ini, S.fim, 'trecho');
}

function mexer(qual, d) {
  if (qual === 'ini') definir(Math.min(S.ini + d, S.fim - MIN), S.fim);
  else definir(S.ini, Math.max(S.fim + d, S.ini + MIN));
}

function andar(sentido) {
  const len = S.fim - S.ini;
  if (sentido > 0) {
    if (S.fim >= S.musica.dur - MIN) { D.aviso('Chegou no fim da música'); return; }
    definir(S.fim, S.fim + len, { tocarDepois: true });
  } else {
    if (S.ini <= 0) { D.aviso('Já está no começo'); return; }
    const ini = Math.max(0, S.ini - len);
    definir(ini, ini + len, { tocarDepois: true });
  }
}

function marcarInicio() {
  const pos = posicao();
  if (pos == null) { D.aviso('Toque ▶ Música e marque na hora certa', 2500); return; }
  const len = S.fim - S.ini;
  definir(pos, S.fim > pos + MIN ? S.fim : pos + len);
}

function marcarFim() {
  const pos = posicao();
  if (pos == null) { D.aviso('Toque ▶ Música e marque na hora certa', 2500); return; }
  if (pos <= S.ini + MIN) { D.aviso('O fim tem que vir depois do início'); return; }
  definir(S.ini, pos);
  pararPlay();
}

// ------------------------------------------------------------------ som
function tocar(a, b, tipo) {
  pararPlay();
  const { ctx, motor } = D.audio();
  const src = ctx.createBufferSource();
  src.buffer = S.musica.buf;
  src.connect(motor.volumeGeral);
  const t = ctx.currentTime + 0.02;
  src.start(t, a, Math.max(0.01, b - a));
  S.play = { src, t, a, b, tipo };
  src.onended = () => {
    if (S.play && S.play.src === src) { S.play = null; atualizar(); }
  };
  atualizar();
  animar();
}

function pararPlay() {
  if (!S.play) return;
  const p = S.play;
  S.play = null;
  try { p.src.onended = null; p.src.stop(); } catch {}
  if (aberto && S.musica && $('smOuvir')) atualizar();
}

function posicao() {
  if (!S.play) return null;
  const { ctx } = D.audio();
  return Math.min(S.play.b, S.play.a + Math.max(0, ctx.currentTime - S.play.t));
}

let rafId = null;
function animar() {
  if (rafId) return;
  const passo = () => {
    rafId = null;
    if (!aberto || !S.musica || !$('smGeral')) return;
    desenhar();
    if (S.play || S.arraste) rafId = requestAnimationFrame(passo);
  };
  rafId = requestAnimationFrame(passo);
}

// ------------------------------------------------------------------ desenho
function medirCanvas() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  for (const id of ['smGeral', 'smZoom']) {
    const c = $(id);
    if (!c) continue;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  S.picosGeral = null;
  S.picosZoom = null;
}

// Mínimo e máximo de cada coluna de pixels entre a e b segundos (mono).
export function calcularPicos(l, r, taxa, a, b, colunas) {
  const out = new Float32Array(colunas * 2);
  const i0 = Math.floor(a * taxa);
  const i1 = Math.max(i0 + 1, Math.ceil(b * taxa));
  const por = (i1 - i0) / colunas;
  const pulo = por > 4000 ? 4 : 1;
  for (let x = 0; x < colunas; x++) {
    const s = i0 + Math.floor(x * por);
    const e = Math.min(l.length, Math.max(s + 1, i0 + Math.floor((x + 1) * por)));
    let mn = 0;
    let mx = 0;
    for (let i = s; i < e; i += pulo) {
      const v = (l[i] + r[i]) * 0.5;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[2 * x] = mn;
    out[2 * x + 1] = mx;
  }
  return out;
}

function picos(qual, c) {
  const m = S.musica;
  if (qual === 'geral') {
    if (!S.picosGeral || S.picosGeral.w !== c.width) S.picosGeral = { w: c.width, p: calcularPicos(m.ch[0], m.ch[1], m.taxa, 0, m.dur, c.width) };
    return S.picosGeral.p;
  }
  const [a, b] = S.janela;
  const chave = `${a}|${b}|${c.width}`;
  if (!S.picosZoom || S.picosZoom.chave !== chave) S.picosZoom = { chave, p: calcularPicos(m.ch[0], m.ch[1], m.taxa, a, b, c.width) };
  return S.picosZoom.p;
}

const vista = (qual) => (qual === 'geral' ? [0, S.musica.dur] : S.janela);

function desenharOnda(c, qual) {
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const [a, b] = vista(qual);
  const px = (t) => ((t - a) / (b - a)) * W;
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--cor').trim() || '#e5342b';
  const dpr = W / Math.max(1, c.clientWidth);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0c0c0e';
  g.fillRect(0, 0, W, H);
  const xi = px(S.ini);
  const xf = px(S.fim);
  g.globalAlpha = 0.22;
  g.fillStyle = cor;
  g.fillRect(xi, 0, xf - xi, H);
  g.globalAlpha = 1;
  const p = picos(qual, c);
  const meio = H / 2;
  const alt = H * 0.46;
  for (let x = 0; x < W; x++) {
    const dentro = x >= xi && x <= xf;
    g.fillStyle = dentro ? '#ffffff' : '#5c5c66';
    const y1 = meio - p[2 * x + 1] * alt;
    const y2 = meio - p[2 * x] * alt;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  // alças
  g.fillStyle = cor;
  for (const x of [xi, xf]) {
    if (x < -20 || x > W + 20) continue;
    g.fillRect(x - dpr, 0, 2 * dpr, H);
    const tab = qual === 'zoom' ? 14 * dpr : 9 * dpr;
    g.beginPath();
    g.roundRect ? g.roundRect(x - tab / 2, H - tab * 1.4, tab, tab * 1.4, 3 * dpr) : g.rect(x - tab / 2, H - tab * 1.4, tab, tab * 1.4);
    g.fill();
  }
  // janela do zoom marcada na música inteira
  if (qual === 'geral') {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = dpr;
    g.strokeRect(px(S.janela[0]), 0.5 * dpr, Math.max(2, px(S.janela[1]) - px(S.janela[0])), H - dpr);
  }
  const pos = posicao();
  if (pos != null && pos >= a && pos <= b) {
    g.fillStyle = '#fff';
    g.fillRect(px(pos) - dpr, 0, 2 * dpr, H);
  }
}

function desenhar() {
  if (!S.musica || !$('smGeral')) return;
  desenharOnda($('smGeral'), 'geral');
  desenharOnda($('smZoom'), 'zoom');
}

function atualizar() {
  if (!S.musica || !$('smIni')) return;
  $('smIni').textContent = tempoTexto(S.ini);
  $('smFim').textContent = tempoTexto(S.fim);
  $('smDur').textContent = `${(S.fim - S.ini).toFixed(2).replace('.', ',')} s`;
  const tTrecho = S.play && S.play.tipo === 'trecho';
  const tMusica = S.play && S.play.tipo === 'musica';
  $('smOuvir').textContent = tTrecho ? '■ Parar' : '▶ Ouvir trecho';
  $('smMusica').textContent = tMusica ? '■ Parar música' : '▶ Música daqui';
  $('smMarcaIni').classList.toggle('pulsa', !!tMusica);
  $('smMarcaFim').classList.toggle('pulsa', !!tMusica);
  desenhar();
}

// ------------------------------------------------------------------ toque na onda
function ligarOnda(c, qual) {
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch {}
    const r = c.getBoundingClientRect();
    const [a, b] = vista(qual);
    const tempo = (cx) => a + (limitar(cx - r.left, 0, r.width) / r.width) * (b - a);
    const xIni = ((S.ini - a) / (b - a)) * r.width;
    const xFim = ((S.fim - a) / (b - a)) * r.width;
    const x = e.clientX - r.left;
    const dI = Math.abs(x - xIni);
    const dF = Math.abs(x - xFim);
    let modo;
    if (Math.min(dI, dF) < (qual === 'zoom' ? 26 : 18) || qual === 'zoom') modo = dI <= dF ? 'ini' : 'fim';
    else modo = 'nova';
    S.arraste = { id: e.pointerId, modo, tempo, x0: e.clientX, ancora: tempo(e.clientX), moveu: false, len: S.fim - S.ini };
    if (modo !== 'nova') moverAlca(e.clientX);
    animar();
  });
  const moverAlca = (cx) => {
    const A = S.arraste;
    const t = A.tempo(cx);
    const dur = S.musica.dur;
    if (A.modo === 'ini') S.ini = limitar(t, Math.max(0, S.fim - MAX), S.fim - MIN);
    else if (A.modo === 'fim') S.fim = limitar(t, S.ini + MIN, Math.min(dur, S.ini + MAX));
    else {
      const x = Math.min(A.ancora, t);
      const y = Math.max(A.ancora, t);
      S.ini = x;
      S.fim = limitar(y, x + MIN, Math.min(dur, x + MAX));
    }
    $('smIni').textContent = tempoTexto(S.ini);
    $('smFim').textContent = tempoTexto(S.fim);
    $('smDur').textContent = `${(S.fim - S.ini).toFixed(2).replace('.', ',')} s`;
  };
  c.addEventListener('pointermove', (e) => {
    const A = S.arraste;
    if (!A || A.id !== e.pointerId) return;
    if (Math.abs(e.clientX - A.x0) > 6) A.moveu = true;
    if (A.modo !== 'nova' || A.moveu) moverAlca(e.clientX);
  });
  const soltar = (e) => {
    const A = S.arraste;
    if (!A || A.id !== e.pointerId) return;
    S.arraste = null;
    if (A.modo === 'nova' && !A.moveu) {
      const ini = limitar(A.ancora, 0, Math.max(0, S.musica.dur - A.len));
      definir(ini, ini + A.len, { tocarDepois: true });
      return;
    }
    definir(S.ini, S.fim, { tocarDepois: true });
  };
  c.addEventListener('pointerup', soltar);
  c.addEventListener('pointercancel', soltar);
}
