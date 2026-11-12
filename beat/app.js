// Batuque — pads de beat para o iPhone.
//
// Fluxo de gravação (estilo loop station):
//   RECORD sem beat: grava; RECORD de novo fecha o beat (que já vai para
//     Gravações). Com LOOP ligado ele continua tocando em loop sem emenda.
//   RECORD com beat: grava por cima (nova camada) enquanto o loop toca.
//   ▶ toca/para. CLEAR tira o beat dos pads (a cópia em Gravações fica).

import { PACOTES, pacotePorId, somDoPad, tipoDoPad, gruposDoPad } from './sons.js';
import { Motor } from './motor.js';
import {
  compasso, batida, posicionar, fecharTake, eventosNaJanela, batidasNaJanela,
  reescalar, ultimaCamada, desfazerCamada, limparEventos, ordenar, descreverDuracao,
  limitarBpm, BPM_MIN, BPM_MAX,
} from './tempo.js';
import { codificarWav, aparar, tirarSilencio } from './wav.js';
import * as db from './db.js';
import { gravarSaida } from './gravador.js';
import { configurarSampler, abrirSampler, fecharSampler, samplerAberto, tempoTexto } from './sampler.js';

const VERSAO_APP = '1.2';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

// ===================================================================
// Ajustes guardados no aparelho
// ===================================================================
const CHAVE_CFG = 'batuque.cfg';
const CHAVE_TAKE = 'batuque.take';
const FX = [
  { id: 'reverb', nome: 'REVERB' },
  { id: 'delay', nome: 'DELAY' },
  { id: 'dist', nome: 'DISTORTION' },
];

function lerJson(chave) {
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch { return null; }
}
function gravarJson(chave, v) {
  try {
    if (v == null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(v));
  } catch {}
}

function carregarCfg() {
  const c = lerJson(CHAVE_CFG) || {};
  const num01 = (v) => (Number.isFinite(v) ? limitar(v, 0, 1) : 0);
  const pac = pacotePorId(c.pacote);
  return {
    pacote: pac.id,
    banco: c.banco === 1 ? 1 : 0,
    bpm: limitarBpm(c.bpm ?? pac.bpm),
    metronomo: c.metronomo ?? true,
    contagem: c.contagem ?? true,
    ajustar: c.ajustar ?? true,
    loop: c.loop ?? true,
    fx: { reverb: num01(c.fx?.reverb), delay: num01(c.fx?.delay), dist: num01(c.fx?.dist) },
    volume: Number.isFinite(c.volume) ? limitar(c.volume, 0, 1) : 1,
    nomes: c.nomes ?? true,
    pads: c.pads && typeof c.pads === 'object' ? c.pads : {},
    contador: Number.isInteger(c.contador) ? c.contador : 0,
    contadorAudio: Number.isInteger(c.contadorAudio) ? c.contadorAudio : 0,
  };
}
const cfg = carregarCfg();
const salvarCfg = () => gravarJson(CHAVE_CFG, cfg);

function eventoValido(e, dur) {
  return e && Number.isFinite(e.t) && e.t >= 0 && e.t < dur
    && Number.isInteger(e.pad) && e.pad >= 0 && e.pad < 32
    && PACOTES.some((p) => p.id === e.pacote);
}

function takeValido(t) {
  if (!t || !(t.dur > 0) || !Array.isArray(t.eventos)) return null;
  const eventos = t.eventos.filter((e) => eventoValido(e, t.dur)).map((e) => ({ ...e, camada: e.camada || 0 }));
  if (!eventos.length) return null;
  return { id: t.id ?? null, nome: t.nome ?? null, criada: t.criada ?? null, bpm: limitarBpm(t.bpm), dur: t.dur, eventos: ordenar(eventos) };
}

// ===================================================================
// Áudio
// ===================================================================
let ctx = null;
let motor = null;

function iniciarAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    // Faz o som sair mesmo com a chave de silencioso ligada (iOS 16.4+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    motor = new Motor(ctx, { vivo: true });
    motor.efeitos(cfg.fx, bpmAtual());
    motor.volume(cfg.volume);
    // Um "nada" tocado dentro do toque destrava o áudio no Safari.
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    carregarAmostrasUsadas();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

for (const ev of ['pointerdown', 'touchend', 'click']) {
  document.addEventListener(ev, () => iniciarAudio(), { capture: true, passive: true });
}

function decodificar(buf) {
  return new Promise((ok, falha) => {
    const p = ctx.decodeAudioData(buf, ok, falha);
    if (p && p.then) p.then(ok, falha);
  });
}

// Amostras que o usuário colocou nos pads: id → AudioBuffer (ou a promessa dele).
const amostras = new Map();

function carregarAmostra(id) {
  if (amostras.has(id)) return Promise.resolve(amostras.get(id));
  const p = db.pegar(db.AMOSTRAS, id)
    .then((reg) => (reg ? decodificar(reg.wav.slice(0)) : null))
    .then((buf) => { if (buf) amostras.set(id, buf); else amostras.delete(id); return buf; })
    .catch(() => { amostras.delete(id); return null; });
  amostras.set(id, p);
  return p;
}

function bufferPronto(id) {
  const b = amostras.get(id);
  return b && typeof b.getChannelData === 'function' ? b : null;
}

function carregarAmostrasUsadas() {
  for (const pads of Object.values(cfg.pads)) {
    for (const aj of Object.values(pads)) if (aj && aj.amostraId != null) carregarAmostra(aj.amostraId);
  }
}

const ajustePad = (pacote, pad) => cfg.pads[pacote]?.[pad] || null;

// ===================================================================
// Transporte
// ===================================================================
const T = {
  take: null,       // { id, nome, criada, bpm, dur, eventos }
  tocando: false,
  inicio: 0,        // tempo do áudio em que a volta 0 do loop começou
  fim: null,        // sem loop: quando o play acaba
  agendadoAte: 0,
  grav: null,       // { modo: 'novo', t0, toques } | { modo: 'camada', camada, novos }
  metro: null,      // { base, desde, ate }
  agendadas: [],    // vozes já marcadas no futuro (para poder cancelar)
};
T.take = takeValido(lerJson(CHAVE_TAKE));

const bpmAtual = () => (T.take ? T.take.bpm : cfg.bpm);
const ativo = () => T.tocando || !!T.grav || !!T.metro;
let filaLuz = [];

function tocarPad(pacote, pad, quando, agendado) {
  const som = somDoPad(pacote, pad);
  const aj = ajustePad(pacote, pad);
  const buf = aj && aj.amostraId != null ? bufferPronto(aj.amostraId) : null;
  const voz = motor.tocar(som, quando, aj || {}, buf, gruposDoPad(aj));
  if (agendado) {
    T.agendadas.push(voz);
    filaLuz.push({ quando, pacote, pad });
  }
  return voz;
}

function registrarToque(agora, pad) {
  const G = T.grav;
  if (!G) return;
  if (G.modo === 'novo') {
    if (G.t0 == null) {
      G.t0 = agora;
      if (cfg.metronomo) {
        T.metro = { base: agora, desde: agora + 0.02, ate: null };
        T.agendadoAte = agora;
      }
      render();
    }
    const rel = agora - G.t0;
    if (rel < -0.12) return; // muito antes do fim da contagem: só toca, não grava
    G.toques.push({ t: Math.max(0, rel), pacote: cfg.pacote, pad });
  } else {
    const rel = agora - T.inicio;
    if (rel < -0.12) return;
    const { t, ciclo } = posicionar(rel, T.take.dur, T.take.bpm, cfg.ajustar);
    T.take.eventos.push({ t, pacote: cfg.pacote, pad, camada: G.camada, _ciclo: ciclo });
    G.novos += 1;
  }
}

function comecarPlay(inicio) {
  for (const e of T.take.eventos) delete e._ciclo;
  T.tocando = true;
  T.inicio = inicio;
  T.fim = cfg.loop ? null : inicio + T.take.dur;
  T.agendadoAte = ctx.currentTime;
  ligarRelogio();
}

function apertarRec() {
  iniciarAudio();
  pararPrevia();
  if (T.grav) { pararGravacao(); return; }
  const agora = ctx.currentTime;
  const bpm = bpmAtual();
  const estavaParado = !ativo();
  if (!T.take) {
    if (cfg.contagem) {
      const t0 = agora + 0.15 + compasso(bpm);
      T.grav = { modo: 'novo', t0, toques: [] };
      T.metro = { base: t0, desde: agora + 0.1, ate: cfg.metronomo ? null : t0 };
    } else {
      T.grav = { modo: 'novo', t0: null, toques: [] };
      T.metro = null;
      aviso('Toque um pad para começar a gravar');
    }
    if (estavaParado) T.agendadoAte = agora;
  } else {
    let contou = false;
    if (!T.tocando) {
      contou = cfg.contagem;
      comecarPlay(agora + 0.15 + (contou ? compasso(bpm) : 0));
    }
    T.grav = { modo: 'camada', camada: ultimaCamada(T.take.eventos) + 1, novos: 0 };
    if (cfg.metronomo) T.metro = { base: T.inicio, desde: agora + 0.05, ate: null };
    else if (contou) T.metro = { base: T.inicio, desde: agora + 0.05, ate: T.inicio };
    else T.metro = null;
    aviso('Gravando por cima do beat');
  }
  ligarRelogio();
  render();
}

function cancelarCliquesFuturos(agora) {
  for (const v of T.agendadas) if (v.clique && v.inicio > agora) v.parar(agora);
}

const ATRASO_EMENDA = 0.25;

function pararGravacao() {
  const G = T.grav;
  if (!G) return;
  T.grav = null;
  const agora = ctx.currentTime;
  T.metro = null;
  cancelarCliquesFuturos(agora);
  if (G.modo === 'novo') {
    if (G.t0 == null || !G.toques.length || agora <= G.t0) {
      aviso('Nada foi gravado');
      render();
      return;
    }
    const { dur, eventos } = fecharTake(G.toques, agora - G.t0, cfg.bpm, cfg.ajustar);
    T.take = { id: null, nome: null, criada: null, bpm: cfg.bpm, dur, eventos };
    salvarTake();
    if (cfg.loop) {
      // Continua de onde está, sem emenda: a volta 0 começou em t0.
      T.tocando = true;
      T.inicio = G.t0;
      T.fim = null;
      // Quem fecha o loop costuma apertar um tiquinho depois da virada do
      // compasso: os toques da volta nova que ficaram para trás nesses
      // instantes tocam agora, em vez de sumir.
      const fase = (agora - T.inicio) % dur;
      if (agora - T.inicio >= dur && fase < ATRASO_EMENDA) {
        for (const { ev } of eventosNaJanela(eventos, T.inicio, dur, agora - fase, agora)) {
          tocarPad(ev.pacote, ev.pad, agora, true);
        }
      }
      T.agendadoAte = agora;
      ligarRelogio();
      aviso('Beat gravado · tocando em loop');
    } else {
      aviso('Beat gravado — toque ▶ para ouvir');
    }
  } else if (G.novos) {
    ordenar(T.take.eventos);
    salvarTake();
    aviso('Camada gravada');
  } else {
    aviso('Nada novo foi gravado');
  }
  render();
}

function pararTudo({ descartar = false } = {}) {
  if (T.grav) {
    if (descartar) T.grav = null;
    else pararGravacao();
  }
  T.tocando = false;
  T.fim = null;
  T.metro = null;
  if (ctx) {
    const agora = ctx.currentTime;
    for (const v of T.agendadas) if (v.inicio > agora + 0.003) v.parar(agora);
  }
  T.agendadas = [];
  filaLuz = [];
  render();
}

function terminarPlay() {
  if (T.grav) pararGravacao();
  T.tocando = false;
  T.fim = null;
  render();
}

function apertarPlay() {
  iniciarAudio();
  pararPrevia();
  if (T.tocando || T.grav) { pararTudo(); return; }
  if (!T.take) { aviso('Grave um beat primeiro: toque RECORD'); return; }
  comecarPlay(ctx.currentTime + 0.06);
  render();
}

function apertarLoop() {
  cfg.loop = !cfg.loop;
  salvarCfg();
  if (T.tocando && T.take && ctx) {
    if (cfg.loop) T.fim = null;
    else {
      const k = Math.max(0, Math.floor((ctx.currentTime - T.inicio) / T.take.dur));
      T.fim = T.inicio + (k + 1) * T.take.dur;
    }
  }
  aviso(cfg.loop ? 'Loop ligado' : 'Loop desligado');
  render();
}

function apertarClear() {
  if (!T.take && !T.grav) { aviso('Nada para limpar'); return; }
  const salvo = T.take?.id != null;
  pararTudo({ descartar: true });
  T.take = null;
  gravarJson(CHAVE_TAKE, null);
  render();
  aviso(salvo ? 'Pads limpos — o beat continua em Gravações' : 'Limpo');
}

// ===================================================================
// Gravar o som que sai (botão ⏺ do lado do ▶)
// ===================================================================
const MAX_AUDIO = 5 * 60;
let gravAudio = null;      // { rec, timer }
let iniciandoAudio = false;

async function alternarGravacaoAudio() {
  if (iniciandoAudio) return;
  if (gravAudio) { await pararGravacaoAudio(); return; }
  iniciarAudio();
  pararPrevia();
  iniciandoAudio = true;
  try {
    const rec = await gravarSaida(ctx, motor.lim);
    const inicio = Date.now();
    const timer = setInterval(() => {
      const seg = rec.segundos();
      $('bAudio').querySelector('.tempo-audio').textContent = tempoTexto(Math.max(seg, (Date.now() - inicio) / 1000 - 0.3)).replace(/,\d+$/, '');
      if (seg >= MAX_AUDIO) { pararGravacaoAudio(); aviso('Limite de 5 minutos: gravação salva'); }
    }, 250);
    gravAudio = { rec, timer };
    aviso('Gravando o som — toque ⏺ de novo para parar');
  } catch (e) {
    aviso(`Não consegui gravar o som: ${e?.message || e}`, 3000);
  } finally {
    iniciandoAudio = false;
    render();
  }
}

async function pararGravacaoAudio() {
  const g = gravAudio;
  if (!g) return;
  gravAudio = null;
  clearInterval(g.timer);
  render();
  const res = await g.rec.parar();
  if (!res) return;
  const limpo = tirarSilencio(res.canais, res.taxa);
  if (!limpo) { aviso('Nada foi gravado — só silêncio'); return; }
  try {
    cfg.contadorAudio += 1;
    salvarCfg();
    const agora = Date.now();
    await db.salvar(db.GRAVACOES, {
      tipo: 'audio',
      nome: `Áudio ${cfg.contadorAudio}`,
      criada: agora,
      atualizada: agora,
      dur: limpo[0].length / res.taxa,
      taxa: res.taxa,
      wav: codificarWav(limpo, res.taxa),
    });
    aviso('Áudio salvo em Gravações');
    if (telaAtual === 'tela-gravacoes') renderGravacoes();
  } catch (e) {
    aviso(`Não consegui salvar o áudio: ${e?.message || e}`, 3000);
  }
}

function trocarBanco() {
  cfg.banco = cfg.banco ? 0 : 1;
  salvarCfg();
  render();
}

// ===================================================================
// Agendador (relógio do áudio) e desenho
// ===================================================================
const ANTECEDENCIA = 0.12;
let relogio = null;
let raf = null;

function ligarRelogio() {
  if (!relogio) relogio = setInterval(agendar, 25);
  agendar();
  if (!raf) raf = requestAnimationFrame(quadro);
}

function agendar() {
  if (!ctx) return;
  const agora = ctx.currentTime;
  const ate = agora + ANTECEDENCIA;
  // Se o relógio atrasou (app em segundo plano), não despeja tudo de uma vez.
  const de = Math.max(T.agendadoAte, agora - 0.02);
  if (T.tocando && T.take) {
    const limite = T.fim != null ? Math.min(ate, T.fim) : ate;
    for (const { quando, ev } of eventosNaJanela(T.take.eventos, T.inicio, T.take.dur, de, limite)) {
      tocarPad(ev.pacote, ev.pad, Math.max(quando, agora), true);
    }
  }
  if (T.metro) {
    for (const b of batidasNaJanela(T.metro.base, bpmAtual(), de, ate)) {
      if (b.quando < T.metro.desde || (T.metro.ate != null && b.quando >= T.metro.ate)) continue;
      const v = motor.clique(Math.max(b.quando, agora), b.forte);
      v.clique = true;
      T.agendadas.push(v);
    }
  }
  T.agendadoAte = Math.max(T.agendadoAte, ate);
  if (T.tocando && T.fim != null && agora >= T.fim) terminarPlay();
  if (T.agendadas.length > 64) T.agendadas = T.agendadas.filter((v) => v.fim > agora);
  if (!ativo()) { clearInterval(relogio); relogio = null; }
}

function acender(pacote, pad) {
  if (pacote !== cfg.pacote || Math.floor(pad / 16) !== cfg.banco) return;
  const el = padsEl[pad % 16];
  el.classList.remove('aceso');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('aceso');
}

let ultimoVisual = '';
function quadro() {
  raf = null;
  const agora = ctx ? ctx.currentTime : 0;
  if (filaLuz.length) {
    const resta = [];
    for (const x of filaLuz) (x.quando <= agora ? acender(x.pacote, x.pad) : resta.push(x));
    filaLuz = resta;
  }
  desenharTempo(agora);
  if (ativo() || filaLuz.length) raf = requestAnimationFrame(quadro);
}

// Os 4 traços embaixo dos botões marcam as batidas do compasso; o RECORD
// mostra a contagem regressiva.
function desenharTempo(agora) {
  let base = null;
  if (T.grav?.modo === 'novo') base = T.grav.t0;
  else if (T.tocando) base = T.inicio;
  let n = null;
  if (base != null && ctx) n = Math.floor((agora - base) / batida(bpmAtual()) + 1e-6);

  let rec = 'RECORD';
  let recClasse = '';
  if (T.grav) {
    if (T.grav.modo === 'novo' && T.grav.t0 == null) { rec = 'REC'; recClasse = 'armado'; }
    else if (n != null && n < 0) { rec = String(-n); recClasse = 'armado'; }
    else { rec = 'REC'; recClasse = 'gravando'; }
  }
  let barra = -1;
  let contagem = false;
  if (n != null) {
    if (n < 0) { contagem = true; barra = limitar(n + 4, 0, 3); }
    else barra = n % 4;
  }
  const chave = `${rec}|${recClasse}|${barra}|${contagem}`;
  if (chave === ultimoVisual) return;
  ultimoVisual = chave;
  const bRec = $('bRec');
  bRec.querySelector('.rotulo').textContent = rec;
  bRec.classList.toggle('armado', recClasse === 'armado');
  bRec.classList.toggle('gravando', recClasse === 'gravando');
  barrasEl.forEach((b, i) => {
    b.classList.toggle('ativa', i === barra && !contagem);
    b.classList.toggle('contagem', i === barra && contagem);
  });
}

// ===================================================================
// Gravações: salvar o beat atual
// ===================================================================
let filaSalvar = Promise.resolve();

function guardarTakeLocal() {
  const t = T.take;
  gravarJson(CHAVE_TAKE, t ? { id: t.id, nome: t.nome, criada: t.criada, bpm: t.bpm, dur: t.dur, eventos: limparEventos(t.eventos) } : null);
}

function fotoDosPads(eventos) {
  const usados = new Set(eventos.map((e) => e.pacote));
  const foto = {};
  for (const p of usados) if (cfg.pads[p]) foto[p] = JSON.parse(JSON.stringify(cfg.pads[p]));
  return foto;
}

function salvarTake() {
  const take = T.take;
  if (!take) return;
  guardarTakeLocal();
  filaSalvar = filaSalvar.then(async () => {
    const reg = {
      nome: take.nome,
      criada: take.criada,
      atualizada: Date.now(),
      bpm: take.bpm,
      dur: take.dur,
      eventos: limparEventos(take.eventos),
      fx: { ...cfg.fx },
      pads: fotoDosPads(take.eventos),
    };
    if (take.id != null) reg.id = take.id;
    if (!reg.nome) {
      cfg.contador += 1;
      salvarCfg();
      reg.nome = `Beat ${cfg.contador}`;
    }
    if (!reg.criada) reg.criada = Date.now();
    const id = await db.salvar(db.GRAVACOES, reg);
    take.id = id;
    take.nome = reg.nome;
    take.criada = reg.criada;
    if (T.take === take) guardarTakeLocal();
    if (telaAtual === 'tela-gravacoes') renderGravacoes();
  }).catch((e) => aviso(`Não consegui salvar: ${e?.message || e}`));
}

let salvarDepois = null;
function salvarTakeEmBreve() {
  clearTimeout(salvarDepois);
  salvarDepois = setTimeout(salvarTake, 700);
}

// ===================================================================
// Interface: pads, knobs, botões
// ===================================================================
const grade = $('grade');
const padsEl = [];
const barrasEl = [...$('batidas').children];
let editando = false;

for (let i = 0; i < 16; i++) {
  const b = document.createElement('div');
  b.className = 'pad';
  b.dataset.i = i;
  b.innerHTML = '<span class="nome-pad"></span><i class="marca-corta"></i>';
  grade.appendChild(b);
  padsEl.push(b);
}

const dedos = new Map(); // pointerId → elemento do pad
grade.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pad');
  if (!el) return;
  e.preventDefault();
  iniciarAudio();
  const i = Number(el.dataset.i);
  const pad = cfg.banco * 16 + i;
  dedos.set(e.pointerId, el);
  el.classList.add('apertado');
  const agora = ctx.currentTime;
  tocarPad(cfg.pacote, pad, agora, false);
  if (editando) { abrirEditorPad(cfg.pacote, pad); return; }
  registrarToque(agora, pad);
});
function soltar(e) {
  const el = dedos.get(e.pointerId);
  if (!el) return;
  dedos.delete(e.pointerId);
  if ([...dedos.values()].includes(el)) return;
  el.classList.remove('apertado');
  el.classList.remove('aceso');
  void el.offsetWidth;
  el.classList.add('aceso');
}
window.addEventListener('pointerup', soltar);
window.addEventListener('pointercancel', soltar);
grade.addEventListener('contextmenu', (e) => e.preventDefault());

// Knobs: arrastar para cima/direita aumenta; dois toques zeram.
const CIRC = 2 * Math.PI * 46;
const knobsEl = {};
for (const f of FX) {
  const caixa = document.createElement('div');
  caixa.className = 'knob-caixa';
  caixa.innerHTML = `
    <div class="knob">
      <svg class="arco" viewBox="0 0 100 100"><circle class="trilho" cx="50" cy="50" r="46"/><circle class="valor" cx="50" cy="50" r="46"/></svg>
      <span class="nome ${f.nome.length > 8 ? 'longo' : ''}">${f.nome}</span>
      <span class="valor-txt"></span>
      <div class="ponteiro"></div>
    </div>
    <div class="minmax"><span>MIN ◂</span><span>▸ MAX</span></div>`;
  $('knobs').appendChild(caixa);
  knobsEl[f.id] = caixa;
  caixa.querySelector('.trilho').setAttribute('stroke-dasharray', `${CIRC * 0.75} ${CIRC}`);

  let arr = null;
  let ultimoToque = 0;
  const knob = caixa.querySelector('.knob');
  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { knob.setPointerCapture(e.pointerId); } catch {}
    arr = { id: e.pointerId, x: e.clientX, y: e.clientY, v: cfg.fx[f.id], mexeu: false };
    caixa.classList.add('mexendo');
  });
  knob.addEventListener('pointermove', (e) => {
    if (!arr || e.pointerId !== arr.id) return;
    const d = ((arr.y - e.clientY) + (e.clientX - arr.x) * 0.6) / 170;
    if (Math.abs(d) > 0.015) arr.mexeu = true;
    if (arr.mexeu) mudarFx(f.id, limitar(arr.v + d, 0, 1));
  });
  const fim = (e) => {
    if (!arr || e.pointerId !== arr.id) return;
    const agoraMs = Date.now();
    if (!arr.mexeu) {
      if (agoraMs - ultimoToque < 350) { mudarFx(f.id, 0); ultimoToque = 0; aviso(`${f.nome} zerado`); }
      else ultimoToque = agoraMs;
    }
    arr = null;
    caixa.classList.remove('mexendo');
    salvarCfg();
    if (T.take && !T.grav) salvarTakeEmBreve(); // a gravação guarda os efeitos atuais
  };
  knob.addEventListener('pointerup', fim);
  knob.addEventListener('pointercancel', fim);
}

function desenharKnob(id) {
  const v = cfg.fx[id];
  const caixa = knobsEl[id];
  caixa.querySelector('.ponteiro').style.setProperty('--ang', `${-135 + 270 * v}deg`);
  caixa.querySelector('.valor').setAttribute('stroke-dasharray', `${CIRC * 0.75 * v} ${CIRC}`);
  caixa.querySelector('.valor-txt').textContent = `${Math.round(v * 100)}%`;
  caixa.classList.toggle('com-valor', v > 0);
}

function mudarFx(id, v) {
  cfg.fx[id] = v;
  if (motor) motor.efeitos(cfg.fx, bpmAtual());
  desenharKnob(id);
}

function apertarEm(el, fn) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  el.addEventListener('click', (e) => e.preventDefault());
}
apertarEm($('bRec'), apertarRec);
apertarEm($('bPlay'), apertarPlay);
apertarEm($('bBanco'), trocarBanco);
apertarEm($('bAudio'), alternarGravacaoAudio);
$('bLoop').addEventListener('click', apertarLoop);
$('bClear').addEventListener('click', apertarClear);
$('bOpcoes').addEventListener('click', () => {
  if (editando) { editando = false; render(); aviso('Edição concluída'); return; }
  abrirOpcoes();
});

function aplicarCor() {
  document.documentElement.style.setProperty('--cor', pacotePorId(cfg.pacote).cor);
}

function render() {
  aplicarCor();
  const bolas = $('bBanco').children;
  bolas[0].classList.toggle('ativa', cfg.banco === 0);
  bolas[1].classList.toggle('ativa', cfg.banco === 1);
  $('bLoop').classList.toggle('ligado', cfg.loop);
  const ocupado = T.tocando || !!T.grav;
  $('bPlay').classList.toggle('tocando', ocupado);
  $('iconePlay').innerHTML = ocupado
    ? '<rect x="6" y="6" width="12" height="12" rx="2"/>'
    : '<path d="M7 4.5v15l12.5-7.5z"/>';
  $('bPlay').setAttribute('aria-label', ocupado ? 'Parar' : 'Tocar');
  $('bOpcoes').lastChild.textContent = editando ? 'PRONTO' : 'OPTIONS';
  $('bAudio').classList.toggle('gravando', !!gravAudio);
  $('bAudio').setAttribute('aria-label', gravAudio ? 'Parar gravação do som' : 'Gravar o som que sai');
  if (!gravAudio) $('bAudio').querySelector('.tempo-audio').textContent = '';
  $('tela-pads').classList.toggle('editando', editando);
  grade.classList.toggle('sem-nomes', !cfg.nomes);
  for (let i = 0; i < 16; i++) {
    const pad = cfg.banco * 16 + i;
    const aj = ajustePad(cfg.pacote, pad);
    const temAmostra = aj && aj.amostraId != null;
    padsEl[i].classList.toggle('amostra', !!temAmostra);
    padsEl[i].classList.toggle('corta', tipoDoPad(aj) === 'corta');
    padsEl[i].firstChild.textContent = temAmostra ? (aj.amostraNome || 'Amostra') : somDoPad(cfg.pacote, pad).nome;
  }
  for (const f of FX) desenharKnob(f.id);
  ultimoVisual = '';
  desenharTempo(ctx ? ctx.currentTime : 0);
  if (ativo() && !raf) raf = requestAnimationFrame(quadro);
}

// ===================================================================
// Avisos e folha de baixo
// ===================================================================
let avisoTimer = null;
function aviso(msg, ms = 2000) {
  const el = $('aviso');
  el.textContent = msg;
  el.classList.add('visivel');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('visivel'), ms);
}

let aoFecharFolha = null;
let folhaAbertaEm = 0;
function abrirFolha(html, montar, aoFechar) {
  folhaAbertaEm = performance.now();
  if (aoFecharFolha) { const f = aoFecharFolha; aoFecharFolha = null; f(); }
  $('conteudoFolha').innerHTML = html;
  $('folha').scrollTop = 0;
  $('folha').classList.add('aberta');
  $('fundoFolha').classList.add('aberta');
  aoFecharFolha = aoFechar || null;
  if (montar) montar($('conteudoFolha'));
}
function fecharFolha() {
  $('folha').classList.remove('aberta');
  $('fundoFolha').classList.remove('aberta');
  if (aoFecharFolha) { const f = aoFecharFolha; aoFecharFolha = null; f(); }
}
// O toque que abriu a folha (num pad, por exemplo) gera um "click" logo depois
// no que estiver embaixo do dedo — que agora é o fundo escuro. Sem esta espera,
// a folha fecharia no mesmo instante em que abriu.
$('fundoFolha').addEventListener('click', () => {
  if (performance.now() - folhaAbertaEm > 450) fecharFolha();
});

// Botão que pede um segundo toque antes de fazer algo sem volta.
function confirmar(btn, acao) {
  const original = btn.innerHTML;
  let armado = false;
  let tm = null;
  btn.addEventListener('click', () => {
    if (!armado) {
      armado = true;
      btn.textContent = 'Toque de novo para confirmar';
      tm = setTimeout(() => { armado = false; btn.innerHTML = original; }, 3000);
      return;
    }
    clearTimeout(tm);
    armado = false;
    btn.innerHTML = original;
    acao();
  });
}

const chaveHtml = (on) => `<span class="chave ${on ? 'on' : ''}"></span>`;

function linhaChaveLocal(id, titulo, sub, on) {
  return `<button class="linha-cfg" id="${id}" style="width:100%;text-align:left">
    <span class="txt">${titulo}${sub ? `<small>${sub}</small>` : ''}</span>${chaveHtml(on)}</button>`;
}

function linhaChave(id, titulo, sub, on) {
  return `<button class="linha-cfg" data-chave="${id}" style="width:100%;text-align:left">
    <span class="txt">${titulo}${sub ? `<small>${sub}</small>` : ''}</span>${chaveHtml(on)}</button>`;
}

function ligarChaves(raiz, aoMudar) {
  raiz.querySelectorAll('[data-chave]').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.chave;
      cfg[k] = !cfg[k];
      salvarCfg();
      b.querySelector('.chave').classList.toggle('on', cfg[k]);
      if (aoMudar) aoMudar(k);
    });
  });
}

// ===================================================================
// OPTIONS
// ===================================================================
function mudarBpm(v) {
  v = limitarBpm(v);
  cfg.bpm = v;
  salvarCfg();
  if (T.take && T.take.bpm !== v) {
    const agora = ctx ? ctx.currentTime : 0;
    const frac = T.tocando ? (((agora - T.inicio) / T.take.dur) % 1 + 1) % 1 : 0;
    Object.assign(T.take, reescalar(T.take, v));
    for (const e of T.take.eventos) delete e._ciclo;
    if (T.tocando) {
      T.inicio = agora - frac * T.take.dur;
      if (T.fim != null) T.fim = T.inicio + T.take.dur;
    }
    salvarTakeEmBreve();
  }
  if (motor) motor.efeitos(cfg.fx, v);
}

function abrirOpcoes() {
  const pac = pacotePorId(cfg.pacote);
  const bpm = bpmAtual();
  const podeDesfazer = T.take && ultimaCamada(T.take.eventos) > 0 && !T.grav;
  abrirFolha(`
    <h3>Opções</h3>
    <p class="sub">Pacote ${esc(pac.nome)} · banco ${cfg.banco ? '○ (acordes e baixo)' : '● (bateria)'}</p>
    <div class="card">
      <h2>Andamento (BPM)</h2>
      <div class="bpm-ctrl">
        <button class="mm" id="bpmMenos" aria-label="Diminuir BPM">−</button>
        <div class="num" id="bpmNum">${bpm}</div>
        <button class="mm" id="bpmMais" aria-label="Aumentar BPM">+</button>
      </div>
      <input type="range" id="bpmFaixa" min="${BPM_MIN}" max="${BPM_MAX}" step="1" value="${bpm}" ${T.grav ? 'disabled' : ''}>
      <p class="sub" style="margin:6px 0 0">${T.take ? 'Mudar o BPM acelera ou desacelera o beat gravado.' : `Sugerido para ${esc(pac.nome)}: ${pac.bpm}.`}</p>
    </div>
    <div class="card">
      ${linhaChave('metronomo', 'Metrônomo ao gravar', 'Clique em cada batida enquanto grava', cfg.metronomo)}
      ${linhaChave('contagem', 'Contagem antes de gravar', '1 compasso (4 cliques) antes de começar', cfg.contagem)}
      ${linhaChave('ajustar', 'Ajustar ao tempo', 'Toques vão para a grade de 1/16 e o loop fecha em compassos inteiros', cfg.ajustar)}
    </div>
    <button class="botao" id="opDesfazer" ${podeDesfazer ? '' : 'disabled'}>↶ Desfazer última camada</button>
    <button class="botao" id="opSamplear">✂ Samplear uma música</button>
    <button class="botao" id="opEditar">✎ Editar pads (volume, afinação, som próprio)</button>
    <button class="botao" id="opFechar">Fechar</button>
  `, (raiz) => {
    const num = raiz.querySelector('#bpmNum');
    const faixa = raiz.querySelector('#bpmFaixa');
    const aplicar = (v) => {
      if (T.grav) { aviso('Pare a gravação para mudar o BPM'); return; }
      mudarBpm(v);
      num.textContent = cfg.bpm;
      faixa.value = cfg.bpm;
    };
    faixa.addEventListener('input', () => aplicar(Number(faixa.value)));
    raiz.querySelector('#bpmMenos').addEventListener('click', () => aplicar(bpmAtual() - 1));
    raiz.querySelector('#bpmMais').addEventListener('click', () => aplicar(bpmAtual() + 1));
    ligarChaves(raiz);
    raiz.querySelector('#opDesfazer').addEventListener('click', () => {
      if (!T.take || T.grav) return;
      T.take.eventos = desfazerCamada(T.take.eventos);
      salvarTake();
      fecharFolha();
      aviso('Última camada desfeita');
    });
    raiz.querySelector('#opSamplear').addEventListener('click', () => { fecharFolha(); abrirSampler(); });
    raiz.querySelector('#opEditar').addEventListener('click', () => {
      editando = true;
      fecharFolha();
      render();
    });
    raiz.querySelector('#opFechar').addEventListener('click', fecharFolha);
  });
}

// ===================================================================
// Editor de pad
// ===================================================================
function mudarTipo(pacote, pad, tipo) {
  mudarAjuste(pacote, pad, { modo: tipo, solto: null });
}

function mudarAjuste(pacote, pad, mudanca) {
  const atual = { ...(ajustePad(pacote, pad) || {}), ...mudanca };
  for (const [k, v] of Object.entries(atual)) if (v == null) delete atual[k];
  if (atual.vol === 1) delete atual.vol;
  if (atual.afin === 0) delete atual.afin;
  cfg.pads[pacote] = cfg.pads[pacote] || {};
  if (Object.keys(atual).length) cfg.pads[pacote][pad] = atual;
  else delete cfg.pads[pacote][pad];
  if (!Object.keys(cfg.pads[pacote]).length) delete cfg.pads[pacote];
  salvarCfg();
  render();
  if (T.take && !T.grav) salvarTakeEmBreve();
}

let gravMic = null;

function abrirEditorPad(pacote, pad) {
  const som = somDoPad(pacote, pad);
  const aj = ajustePad(pacote, pad) || {};
  const vol = Math.round((aj.vol ?? 1) * 100);
  const afin = aj.afin || 0;
  const temAmostra = aj.amostraId != null;
  abrirFolha(`
    <h3>${esc(temAmostra ? aj.amostraNome || 'Amostra' : som.nome)}</h3>
    <p class="sub">${esc(pacotePorId(pacote).nome)} · banco ${pad < 16 ? '●' : '○'} · pad ${(pad % 16) + 1}</p>
    <button class="botao primario" id="edOuvir">▶ Ouvir</button>
    <div class="campo"><label>Volume <span class="val" id="edVolV">${vol}%</span></label>
      <input type="range" id="edVol" min="0" max="150" step="1" value="${vol}"></div>
    <div class="campo"><label>Afinação <span class="val" id="edAfinV">${afin > 0 ? '+' : ''}${afin} st</span></label>
      <input type="range" id="edAfin" min="-12" max="12" step="1" value="${afin}"></div>
    <div class="card">
      <h2>Som</h2>
      <p style="margin:0 0 12px;font-size:14px">${temAmostra ? `Amostra: <b>${esc(aj.amostraNome || 'sem nome')}</b>` : `Original do pacote: <b>${esc(som.nome)}</b>`}</p>
      <button class="botao" id="edCortar">✂ Cortar trecho de uma música</button>
      <button class="botao" id="edArquivo">📁 Importar arquivo curto (inteiro)</button>
      <button class="botao" id="edMic">🎙 Gravar com o microfone</button>
      ${temAmostra ? '<button class="botao" id="edOriginal">↺ Voltar ao som original</button>' : ''}
    </div>
    <div class="campo"><label>Tipo do pad</label>
      <div class="seg" id="edTipo">
        <button data-tipo="corta" class="${tipoDoPad(aj) === 'corta' ? 'on' : ''}">✂ Interrompe</button>
        <button data-tipo="livre" class="${tipoDoPad(aj) === 'livre' ? 'on' : ''}">Não interrompe</button>
      </div>
      <p class="sub" style="margin:6px 0 0">Interrompe: ao tocar, corta o que outro pad "interrompe" estiver tocando.</p>
    </div>
    <button class="botao" id="edFechar">Pronto</button>
  `, (raiz) => {
    const ouvir = () => { iniciarAudio(); tocarPad(pacote, pad, ctx.currentTime, false); };
    raiz.querySelector('#edOuvir').addEventListener('click', ouvir);
    const vEl = raiz.querySelector('#edVol');
    vEl.addEventListener('input', () => {
      raiz.querySelector('#edVolV').textContent = `${vEl.value}%`;
      mudarAjuste(pacote, pad, { vol: Number(vEl.value) / 100 });
    });
    vEl.addEventListener('change', ouvir);
    const aEl = raiz.querySelector('#edAfin');
    aEl.addEventListener('input', () => {
      const v = Number(aEl.value);
      raiz.querySelector('#edAfinV').textContent = `${v > 0 ? '+' : ''}${v} st`;
      mudarAjuste(pacote, pad, { afin: v });
    });
    aEl.addEventListener('change', ouvir);
    raiz.querySelector('#edArquivo').addEventListener('click', () => {
      const inp = $('arquivo');
      inp.value = '';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const nome = f.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Amostra';
        await usarAudio(await f.arrayBuffer(), nome, pacote, pad);
      };
      inp.click();
    });
    raiz.querySelector('#edCortar').addEventListener('click', () => {
      fecharFolha();
      abrirSampler({ destino: { pacote, pad } });
    });
    raiz.querySelectorAll('#edTipo [data-tipo]').forEach((b) => b.addEventListener('click', () => {
      mudarTipo(pacote, pad, b.dataset.tipo);
      raiz.querySelectorAll('#edTipo [data-tipo]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    const bMic = raiz.querySelector('#edMic');
    bMic.addEventListener('click', () => gravarMicrofone(bMic, pacote, pad));
    raiz.querySelector('#edOriginal')?.addEventListener('click', () => {
      mudarAjuste(pacote, pad, { amostraId: null, amostraNome: null, solto: null });
      limparAmostras();
      abrirEditorPad(pacote, pad);
      aviso('Som original de volta');
    });
    raiz.querySelector('#edFechar').addEventListener('click', fecharFolha);
  }, () => {
    if (gravMic) gravMic.parar(true);
    if (telaAtual === 'tela-tipos') renderTipos();
  });
}

async function usarAudio(arrayBuffer, nome, pacote, pad) {
  iniciarAudio();
  let buf;
  try { buf = await decodificar(arrayBuffer); } catch { aviso('Não consegui abrir esse áudio'); return; }
  const canais = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) canais.push(buf.getChannelData(c));
  const limpo = aparar(canais, buf.sampleRate);
  if (!limpo) { aviso('O áudio está em silêncio'); return; }
  try {
    const wav = codificarWav(limpo, buf.sampleRate);
    const id = await db.salvar(db.AMOSTRAS, { nome, wav });
    const pronto = ctx.createBuffer(limpo.length, limpo[0].length, buf.sampleRate);
    limpo.forEach((ch, i) => pronto.getChannelData(i).set(ch));
    amostras.set(id, pronto);
    mudarAjuste(pacote, pad, { amostraId: id, amostraNome: nome });
    limparAmostras();
    abrirEditorPad(pacote, pad);
    tocarPad(pacote, pad, ctx.currentTime, false);
    aviso('Som do pad trocado');
  } catch (e) {
    aviso(`Não consegui guardar o som: ${e?.message || e}`);
  }
}

async function gravarMicrofone(btn, pacote, pad) {
  if (gravMic) { gravMic.parar(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { aviso('Este navegador não grava áudio'); return; }
  iniciarAudio();
  pararTudo();
  const sessao = (tipo) => { try { if (navigator.audioSession) navigator.audioSession.type = tipo; } catch {} };
  sessao('play-and-record');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    sessao('playback');
    aviso('Sem acesso ao microfone. Libere em Ajustes › Safari › Microfone.', 3500);
    return;
  }
  const rec = new MediaRecorder(stream);
  const partes = [];
  let descartar = false;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    sessao('playback');
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    gravMic = null;
    if (btn.isConnected) btn.textContent = '🎙 Gravar com o microfone';
    if (descartar || !partes.length) return;
    const blob = new Blob(partes, { type: rec.mimeType || partes[0].type });
    await usarAudio(await blob.arrayBuffer(), 'Microfone', pacote, pad);
  };
  const tm = setTimeout(() => gravMic && gravMic.parar(), 10000);
  gravMic = {
    parar(sem) {
      clearTimeout(tm);
      descartar = !!sem;
      if (rec.state !== 'inactive') rec.stop();
    },
  };
  rec.start();
  btn.textContent = '■ Parar gravação (máx. 10 s)';
  aviso('Gravando do microfone…');
}

// Apaga do banco as amostras que nenhum pad e nenhuma gravação usam mais.
async function limparAmostras() {
  try {
    const usadas = new Set();
    const juntar = (pads) => {
      for (const p of Object.values(pads || {})) for (const aj of Object.values(p || {})) if (aj && aj.amostraId != null) usadas.add(aj.amostraId);
    };
    juntar(cfg.pads);
    for (const g of await db.listar(db.GRAVACOES)) juntar(g.pads);
    for (const id of await db.chaves(db.AMOSTRAS)) {
      if (!usadas.has(id)) { await db.apagar(db.AMOSTRAS, id); amostras.delete(id); }
    }
  } catch {}
}

// ===================================================================
// Samplear (sampler.js) — o que ele precisa do app
// ===================================================================
function definirAjuste(pacote, pad, aj) {
  cfg.pads[pacote] = cfg.pads[pacote] || {};
  if (aj && Object.keys(aj).length) cfg.pads[pacote][pad] = { ...aj };
  else delete cfg.pads[pacote][pad];
  if (!Object.keys(cfg.pads[pacote]).length) delete cfg.pads[pacote];
  salvarCfg();
  render();
}

configurarSampler({
  audio: () => { iniciarAudio(); return { ctx, motor }; },
  decodificar: (buf) => { iniciarAudio(); return decodificar(buf); },
  aviso,
  pacote: () => cfg.pacote,
  banco: () => cfg.banco,
  nomeDoPad: (pacote, pad) => {
    const aj = ajustePad(pacote, pad);
    return aj && aj.amostraId != null ? aj.amostraNome || 'Amostra' : somDoPad(pacote, pad).nome;
  },
  temAmostra: (pacote, pad) => ajustePad(pacote, pad)?.amostraId != null,
  tocarPad: (pacote, pad) => { iniciarAudio(); tocarPad(pacote, pad, ctx.currentTime, false); },
  pararOutros: () => { pararPrevia(); if (T.tocando || T.grav) pararTudo(); fecharFolha(); },
  // Guarda o trecho como amostra e põe no pad. Devolve o ajuste antigo (para desfazer).
  async colocarNoPad(canais, taxa, nome, pacote, pad) {
    iniciarAudio();
    const wav = codificarWav(canais, taxa);
    const id = await db.salvar(db.AMOSTRAS, { nome, wav });
    const buf = ctx.createBuffer(canais.length, canais[0].length, taxa);
    canais.forEach((ch, i) => buf.getChannelData(i).set(ch));
    amostras.set(id, buf);
    const anterior = ajustePad(pacote, pad);
    const novo = { ...(anterior || {}), amostraId: id, amostraNome: nome };
    delete novo.afin; // trecho de música entra no tom original
    definirAjuste(pacote, pad, novo);
    if (T.take && !T.grav) salvarTakeEmBreve();
    return anterior ? { ...anterior } : null;
  },
  restaurarPad: (pacote, pad, anterior) => {
    definirAjuste(pacote, pad, anterior);
    if (anterior && anterior.amostraId != null) carregarAmostra(anterior.amostraId);
  },
  voltarAoEditor: (pacote, pad) => abrirEditorPad(pacote, pad),
  aoFechar: () => { render(); limparAmostras(); },
});

// ===================================================================
// Aba Pads: tipo de cada pad (interrompe ou não) e atalho para editar
// ===================================================================
let tiposAcao = 'tipo';   // 'tipo' = toque troca o tipo; 'editar' = abre o editor
let tiposBanco = null;

function renderTipos() {
  if (tiposBanco == null) tiposBanco = cfg.banco;
  const pac = pacotePorId(cfg.pacote);
  let html = `
    <p class="sub">Pacote <b style="color:var(--txt)">${esc(pac.nome)}</b> · troque em Pacotes</p>
    <div class="seg" id="tpAcao">
      <button data-acao="tipo" class="${tiposAcao === 'tipo' ? 'on' : ''}">Tocar troca o tipo</button>
      <button data-acao="editar" class="${tiposAcao === 'editar' ? 'on' : ''}">Tocar abre o editor</button>
    </div>
    <div class="chips" style="margin:12px 0">
      <button class="chip ${tiposBanco === 0 ? 'on' : ''}" data-banco="0">● Banco 1</button>
      <button class="chip ${tiposBanco === 1 ? 'on' : ''}" data-banco="1">○ Banco 2</button>
    </div>
    <div class="tp-grade">`;
  for (let i = 0; i < 16; i++) {
    const pad = tiposBanco * 16 + i;
    const aj = ajustePad(cfg.pacote, pad);
    const tipo = tipoDoPad(aj);
    const nome = aj && aj.amostraId != null ? aj.amostraNome || 'Amostra' : somDoPad(cfg.pacote, pad).nome;
    html += `<button class="tp-pad ${tipo}" data-pad="${pad}">
      <span class="tp-num">${i + 1}</span>
      <span class="tp-nome">${esc(nome)}</span>
      <span class="tp-tipo">${tipo === 'corta' ? '✂ Interrompe' : 'Não interrompe'}</span>
    </button>`;
  }
  html += `</div>
    <div class="sm-linha" style="margin-top:12px">
      <button class="botao" id="tpTodosCorta">Todos interrompem</button>
      <button class="botao" id="tpTodosLivre">Nenhum interrompe</button>
    </div>
    <div class="card" style="margin-top:14px">
      <h2>Como funciona</h2>
      <p style="margin:0 0 8px;font-size:14px"><b style="color:var(--cor)">✂ Interrompe</b>: quando você toca o pad, ele corta o som de qualquer outro pad "interrompe" que estiver tocando (e o dele mesmo). Bom para trechos de música e vocais.</p>
      <p style="margin:0;font-size:14px"><b>Não interrompe</b>: os sons se sobrepõem e nunca são cortados. Bom para bateria.</p>
      <p class="sub" style="margin:8px 0 0">Para tudo cortar tudo, use "Todos interrompem". Vale também para o que já está gravado no beat.</p>
    </div>`;
  const raiz = $('conteudoTipos');
  raiz.innerHTML = html;
  raiz.querySelectorAll('#tpAcao [data-acao]').forEach((b) => b.addEventListener('click', () => { tiposAcao = b.dataset.acao; renderTipos(); }));
  raiz.querySelectorAll('[data-banco]').forEach((b) => b.addEventListener('click', () => { tiposBanco = Number(b.dataset.banco); renderTipos(); }));
  raiz.querySelectorAll('.tp-pad').forEach((b) => b.addEventListener('click', () => {
    const pad = Number(b.dataset.pad);
    iniciarAudio();
    if (tiposAcao === 'editar') { tocarPad(cfg.pacote, pad, ctx.currentTime, false); abrirEditorPad(cfg.pacote, pad); return; }
    const novo = tipoDoPad(ajustePad(cfg.pacote, pad)) === 'corta' ? 'livre' : 'corta';
    mudarTipo(cfg.pacote, pad, novo);
    tocarPad(cfg.pacote, pad, ctx.currentTime, false);
    renderTipos();
  }));
  const todos = (tipo) => {
    for (let i = 0; i < 16; i++) mudarTipo(cfg.pacote, tiposBanco * 16 + i, tipo);
    renderTipos();
    aviso(tipo === 'corta' ? 'Todos os pads do banco interrompem' : 'Nenhum pad do banco interrompe');
  };
  raiz.querySelector('#tpTodosCorta').addEventListener('click', () => todos('corta'));
  raiz.querySelector('#tpTodosLivre').addEventListener('click', () => todos('livre'));
}

// ===================================================================
// Pacotes
// ===================================================================
function renderPacotes() {
  $('listaPacotes').innerHTML = `
    <div class="card" style="--c:var(--cor)">
      <button class="pacote" id="pcSamplear">
        <span class="amostra-cor" style="display:grid;place-items:center;font-size:26px;padding:0">✂</span>
        <span class="info">
          <span class="nome">Samplear música</span>
          <div class="desc">Abra um MP3, corte o trecho que quiser e coloque num pad.</div>
        </span>
      </button>
    </div>` + PACOTES.map((p) => `
    <div class="card ${p.id === cfg.pacote ? 'atual' : ''}" style="--c:${p.cor}">
      <button class="pacote" data-pacote="${p.id}">
        <span class="amostra-cor"><i></i><i></i><i></i><i></i></span>
        <span class="info">
          <span class="nome">${esc(p.nome)}</span>
          <div class="desc">${esc(p.desc)}</div>
          <div class="bpm">${p.bpm} BPM · 32 sons</div>
        </span>
        ${p.id === cfg.pacote ? '<span class="selo">Usando</span>' : ''}
      </button>
    </div>`).join('');
  $('pcSamplear').addEventListener('click', () => abrirSampler());
  $('listaPacotes').querySelectorAll('[data-pacote]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = pacotePorId(b.dataset.pacote);
      cfg.pacote = p.id;
      cfg.banco = 0;
      if (!T.take && !T.grav) {
        cfg.bpm = p.bpm;
        if (motor) motor.efeitos(cfg.fx, cfg.bpm);
      }
      salvarCfg();
      render();
      mostrarTela('tela-pads');
      aviso(`${p.nome} carregado`);
    });
  });
}

// ===================================================================
// Gravações
// ===================================================================
let previa = null; // { id, src }
let renderizando = false;

async function renderizarBeat(reg, repeticoes, cauda) {
  iniciarAudio();
  const sr = ctx.sampleRate;
  const total = reg.dur * repeticoes + cauda;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(2, Math.ceil(total * sr), sr);
  const m = new Motor(off, { vivo: false });
  m.efeitos(reg.fx || {}, reg.bpm);
  const eventos = [...reg.eventos].sort((a, b) => a.t - b.t);
  const bufs = new Map();
  for (const e of eventos) {
    const aj = reg.pads?.[e.pacote]?.[e.pad];
    if (aj && aj.amostraId != null && !bufs.has(aj.amostraId)) bufs.set(aj.amostraId, await carregarAmostra(aj.amostraId));
  }
  for (let k = 0; k < repeticoes; k++) {
    for (const e of eventos) {
      const aj = reg.pads?.[e.pacote]?.[e.pad] || {};
      const buf = aj.amostraId != null ? bufs.get(aj.amostraId) || null : null;
      m.tocar(somDoPad(e.pacote, e.pad), 0.02 + k * reg.dur + e.t, aj, buf, gruposDoPad(aj));
    }
  }
  return new Promise((ok, falha) => {
    off.oncomplete = (ev) => ok(ev.renderedBuffer);
    const p = off.startRendering();
    if (p && p.then) p.then(ok, falha);
  });
}

function pararPrevia() {
  if (!previa) return;
  const p = previa;
  previa = null;
  try { p.src.onended = null; p.src.stop(); } catch {}
  if (telaAtual === 'tela-gravacoes') renderGravacoes();
}

async function tocarPrevia(reg) {
  if (previa && previa.id === reg.id) { pararPrevia(); return; }
  pararPrevia();
  pararTudo();
  if (renderizando) return;
  renderizando = true;
  try {
    iniciarAudio();
    const buf = reg.tipo === 'audio' ? await decodificar(reg.wav.slice(0)) : await renderizarBeat(reg, 1, 2.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(motor.volumeGeral);
    src.onended = () => { if (previa && previa.src === src) { previa = null; renderGravacoes(); } };
    src.start();
    previa = { id: reg.id, src };
  } catch (e) {
    aviso(`Não consegui tocar: ${e?.message || e}`);
  } finally {
    renderizando = false;
    renderGravacoes();
  }
}

function dataCurta(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

async function renderGravacoes() {
  let lista;
  try { lista = await db.listar(db.GRAVACOES); } catch (e) {
    $('listaGravacoes').innerHTML = `<div class="vazio">Não consegui abrir as gravações.<br>${esc(e?.message || e)}</div>`;
    return;
  }
  lista.sort((a, b) => (b.atualizada || 0) - (a.atualizada || 0));
  if (!lista.length) {
    $('listaGravacoes').innerHTML = '<div class="vazio">Nada gravado ainda.<br>Na aba <b>Reproduzir</b>, toque <b>RECORD</b> para gravar um beat nos pads, ou o botão <b>⏺</b> do lado do ▶ para gravar o som que sai.</div>';
    return;
  }
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  $('listaGravacoes').innerHTML = lista.map((g) => {
    const tocando = previa && previa.id === g.id;
    const noPad = T.take && T.take.id === g.id;
    return `<div class="card grav">
      <button class="play-mini ${tocando ? 'tocando' : ''}" data-ouvir="${g.id}" aria-label="Ouvir">${tocando ? STOP : PLAY}</button>
      <div class="info">
        <div class="nome">${esc(g.nome)}</div>
        <div class="meta">${g.tipo === 'audio'
          ? `<span class="tipo-audio">ÁUDIO</span> ${dataCurta(g.criada)} · ${tempoTexto(g.dur).replace(/,\d+$/, '')}`
          : `${noPad ? '<span class="no-pad">No pad · </span>' : ''}${dataCurta(g.atualizada || g.criada)} · ${g.bpm} BPM · ${descreverDuracao(g.dur, g.bpm)}`}</div>
      </div>
      <button class="mais" data-mais="${g.id}" aria-label="Mais opções">⋯</button>
    </div>`;
  }).join('');
  const porId = new Map(lista.map((g) => [g.id, g]));
  $('listaGravacoes').querySelectorAll('[data-ouvir]').forEach((b) => {
    b.addEventListener('click', () => tocarPrevia(porId.get(Number(b.dataset.ouvir))));
  });
  $('listaGravacoes').querySelectorAll('[data-mais]').forEach((b) => {
    b.addEventListener('click', () => abrirMenuGravacao(porId.get(Number(b.dataset.mais))));
  });
}

function compartilharArquivo(arquivo, titulo) {
  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    navigator.share({ files: [arquivo], title: titulo }).catch((e) => { if (e && e.name !== 'AbortError') baixar(arquivo); });
  } else baixar(arquivo);
}

function abrirMenuAudio(reg) {
  abrirFolha(`
    <h3>${esc(reg.nome)}</h3>
    <p class="sub">Áudio gravado · ${tempoTexto(reg.dur)}</p>
    <button class="botao primario" id="gCortar">✂ Cortar e colocar num pad</button>
    <button class="botao" id="gCompartilhar">⤓ Compartilhar WAV (Arquivos, WhatsApp…)</button>
    <div class="campo"><label>Nome</label>
      <div style="display:flex;gap:8px"><input class="texto-campo" id="gNome" maxlength="40" value="${esc(reg.nome)}"><button class="chip" id="gRenomear">Salvar</button></div></div>
    <button class="botao perigo" id="gApagar">Apagar gravação</button>
    <button class="botao" id="gFechar">Fechar</button>
  `, (raiz) => {
    raiz.querySelector('#gCortar').addEventListener('click', () => {
      pararPrevia();
      fecharFolha();
      abrirSampler({ fonte: { tipo: 'gravacao', reg } });
    });
    // O arquivo já está pronto: compartilha direto, dentro do toque.
    raiz.querySelector('#gCompartilhar').addEventListener('click', () => {
      compartilharArquivo(new File([reg.wav], nomeArquivo(reg.nome), { type: 'audio/wav' }), reg.nome);
    });
    ligarRenomearApagar(raiz, reg);
  });
}

function ligarRenomearApagar(raiz, reg) {
  raiz.querySelector('#gRenomear').addEventListener('click', async () => {
    const nome = raiz.querySelector('#gNome').value.trim().slice(0, 40);
    if (!nome) { aviso('Escreva um nome'); return; }
    reg.nome = nome;
    try {
      await db.salvar(db.GRAVACOES, reg);
      if (T.take && T.take.id === reg.id) { T.take.nome = nome; guardarTakeLocal(); }
      fecharFolha();
      renderGravacoes();
      aviso('Nome salvo');
    } catch (e) { aviso(`Não consegui salvar: ${e?.message || e}`); }
  });
  confirmar(raiz.querySelector('#gApagar'), async () => {
    if (previa && previa.id === reg.id) pararPrevia();
    try {
      await db.apagar(db.GRAVACOES, reg.id);
      if (T.take && T.take.id === reg.id) { T.take.id = null; T.take.nome = null; T.take.criada = null; guardarTakeLocal(); }
      fecharFolha();
      renderGravacoes();
      limparAmostras();
      aviso('Gravação apagada');
    } catch (e) { aviso(`Não consegui apagar: ${e?.message || e}`); }
  });
  raiz.querySelector('#gFechar').addEventListener('click', fecharFolha);
}

function abrirMenuGravacao(reg) {
  if (!reg) return;
  if (reg.tipo === 'audio') { abrirMenuAudio(reg); return; }
  abrirFolha(`
    <h3>${esc(reg.nome)}</h3>
    <p class="sub">${reg.bpm} BPM · ${descreverDuracao(reg.dur, reg.bpm)} · ${reg.eventos.length} toques</p>
    <button class="botao primario" id="gAbrir">Abrir nos pads</button>
    <button class="botao" id="gExportar">⤓ Exportar WAV (Arquivos, WhatsApp…)</button>
    <div class="campo"><label>Nome</label>
      <div style="display:flex;gap:8px"><input class="texto-campo" id="gNome" maxlength="40" value="${esc(reg.nome)}"><button class="chip" id="gRenomear">Salvar</button></div></div>
    <button class="botao perigo" id="gApagar">Apagar gravação</button>
    <button class="botao" id="gFechar">Fechar</button>
  `, (raiz) => {
    raiz.querySelector('#gAbrir').addEventListener('click', () => {
      pararPrevia();
      pararTudo({ descartar: true });
      T.take = takeValido(reg);
      if (!T.take) { aviso('Essa gravação está vazia'); return; }
      cfg.bpm = T.take.bpm;
      if (reg.fx) cfg.fx = { reverb: reg.fx.reverb || 0, delay: reg.fx.delay || 0, dist: reg.fx.dist || 0 };
      const usado = T.take.eventos[0]?.pacote;
      if (usado) cfg.pacote = usado;
      salvarCfg();
      if (motor) motor.efeitos(cfg.fx, cfg.bpm);
      guardarTakeLocal();
      fecharFolha();
      render();
      mostrarTela('tela-pads');
      aviso(`${reg.nome} nos pads — toque ▶`);
    });
    raiz.querySelector('#gExportar').addEventListener('click', () => abrirExportar(reg));
    ligarRenomearApagar(raiz, reg);
  });
}

function nomeArquivo(nome) {
  return `${(nome || 'beat').replace(/[\\/:*?"<>|]+/g, '').trim() || 'beat'}.wav`;
}

function baixar(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function abrirExportar(reg) {
  const MAX_SEG = 180;
  let rep = [4, 2, 1].find((n) => reg.dur * n <= 60) || 1;
  abrirFolha(`
    <h3>Exportar WAV</h3>
    <p class="sub">${esc(reg.nome)} · com os efeitos que estavam ligados</p>
    <div class="campo"><label>Repetir o loop</label>
      <div class="chips" id="exRep">${[1, 2, 4, 8].map((n) => `<button class="chip" data-n="${n}" ${reg.dur * n > MAX_SEG ? 'disabled style="opacity:.35"' : ''}>${n}×</button>`).join('')}</div>
    </div>
    <p class="sub" id="exDur"></p>
    <button class="botao primario" id="exGerar">Gerar arquivo</button>
    <div id="exPronto"></div>
    <button class="botao" id="exFechar">Fechar</button>
  `, (raiz) => {
    const chips = raiz.querySelectorAll('[data-n]');
    const atualizar = () => {
      chips.forEach((c) => c.classList.toggle('on', Number(c.dataset.n) === rep));
      raiz.querySelector('#exDur').textContent = `Duração: ${(reg.dur * rep + 2.5).toFixed(1).replace('.', ',')} s (com o final do reverb)`;
      raiz.querySelector('#exPronto').innerHTML = '';
    };
    chips.forEach((c) => c.addEventListener('click', () => { if (!c.disabled) { rep = Number(c.dataset.n); atualizar(); } }));
    atualizar();
    raiz.querySelector('#exFechar').addEventListener('click', fecharFolha);
    const gerar = raiz.querySelector('#exGerar');
    gerar.addEventListener('click', async () => {
      if (renderizando) return;
      renderizando = true;
      gerar.disabled = true;
      gerar.textContent = 'Gerando…';
      try {
        const buf = await renderizarBeat(reg, rep, 2.5);
        const wav = codificarWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
        const arquivo = new File([wav], nomeArquivo(reg.nome), { type: 'audio/wav' });
        const pronto = raiz.querySelector('#exPronto');
        // O compartilhar precisa nascer de um toque, por isso vira um segundo botão.
        pronto.innerHTML = `<button class="botao primario" id="exCompartilhar">Compartilhar / Salvar em Arquivos</button>
          <p class="sub" style="margin:8px 0 0">${esc(arquivo.name)} · ${(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB</p>`;
        pronto.querySelector('#exCompartilhar').addEventListener('click', () => compartilharArquivo(arquivo, reg.nome));
      } catch (e) {
        aviso(`Não consegui gerar: ${e?.message || e}`);
      } finally {
        renderizando = false;
        gerar.disabled = false;
        gerar.textContent = 'Gerar arquivo';
      }
    });
  });
}

// ===================================================================
// Configurações
// ===================================================================
function renderConfig() {
  const instalado = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('conteudoConfig').innerHTML = `
    <div class="card">
      <h2>Som</h2>
      <div class="campo" style="margin:4px 0 6px"><label style="color:var(--txt);font-size:15px">Volume geral <span class="val" id="cfVolV" style="float:right;color:var(--fraco)">${Math.round(cfg.volume * 100)}%</span></label>
        <input type="range" id="cfVol" min="0" max="100" step="1" value="${Math.round(cfg.volume * 100)}"></div>
      ${linhaChave('nomes', 'Nomes nos pads', 'Mostra o nome do som em cada pad', cfg.nomes)}
    </div>
    <div class="card">
      <h2>Como usar</h2>
      <ol class="passos">
        <li><b>RECORD</b>: conta 4 e grava. <b>RECORD</b> de novo fecha o loop.</li>
        <li>Com o beat tocando, <b>RECORD</b> grava outra camada por cima.</li>
        <li><b>● ○</b> troca entre bateria e acordes/baixo.</li>
        <li>Botões giram arrastando para cima ou para baixo. Dois toques zeram.</li>
        <li><b>OPTIONS</b>: BPM, metrônomo, desfazer camada e editar pads.</li>
        <li><b>⏺</b> (do lado do ▶) grava o som que sai do app — vai para Gravações, dá para compartilhar ou cortar para um pad.</li>
        <li><b>Samplear</b> (em Pacotes ou OPTIONS): abra um MP3, marque o trecho e toque num pad.</li>
        <li>Aba <b>Pads</b>: escolha quais pads <b>interrompem</b> (cortam o som um do outro) e quais não.</li>
        <li>Se não sair som, desligue o modo silencioso e aumente o volume.</li>
      </ol>
    </div>
    ${instalado ? '' : `<div class="card">
      <h2>Instalar no iPhone</h2>
      <ol class="passos">
        <li>Abra este endereço no <b>Safari</b>.</li>
        <li>Toque em <b>Compartilhar</b> (o quadrado com a seta).</li>
        <li>Escolha <b>Adicionar à Tela de Início</b>.</li>
        <li>Abra pelo ícone <b>Batuque</b>: tela cheia e funciona sem internet.</li>
      </ol>
    </div>`}
    <div class="card">
      <h2>Dados</h2>
      <button class="botao" id="cfPads">Restaurar todos os pads ao original</button>
      <button class="botao perigo" id="cfApagar">Apagar todas as gravações</button>
    </div>
    <p class="sub" style="text-align:center;margin-top:16px">Batuque ${VERSAO_APP} · tudo fica salvo só neste aparelho</p>
  `;
  const raiz = $('conteudoConfig');
  const vol = raiz.querySelector('#cfVol');
  vol.addEventListener('input', () => {
    cfg.volume = Number(vol.value) / 100;
    raiz.querySelector('#cfVolV').textContent = `${vol.value}%`;
    if (motor) motor.volume(cfg.volume);
  });
  vol.addEventListener('change', salvarCfg);
  ligarChaves(raiz, () => render());
  confirmar(raiz.querySelector('#cfPads'), () => {
    cfg.pads = {};
    salvarCfg();
    render();
    limparAmostras();
    aviso('Pads restaurados');
  });
  confirmar(raiz.querySelector('#cfApagar'), async () => {
    pararPrevia();
    try {
      await db.apagarTudo(db.GRAVACOES);
      if (T.take) { T.take.id = null; T.take.nome = null; T.take.criada = null; guardarTakeLocal(); }
      limparAmostras();
      aviso('Gravações apagadas');
    } catch (e) { aviso(`Não consegui apagar: ${e?.message || e}`); }
  });
}

// ===================================================================
// Abas
// ===================================================================
let telaAtual = 'tela-pads';
function mostrarTela(id) {
  telaAtual = id;
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === id));
  document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a.dataset.tela === id));
  if (id === 'tela-pacotes') renderPacotes();
  if (id === 'tela-tipos') { tiposBanco = cfg.banco; renderTipos(); }
  if (id === 'tela-gravacoes') renderGravacoes();
  if (id === 'tela-config') renderConfig();
  if (id !== 'tela-gravacoes') pararPrevia();
  if (editando && id !== 'tela-pads') { editando = false; render(); }
}
document.querySelectorAll('.aba').forEach((a) => a.addEventListener('click', () => mostrarTela(a.dataset.tela)));

// ===================================================================
// Ciclo de vida
// ===================================================================
// O iPhone pausa o áudio quando o app sai da tela: fecha a gravação direitinho
// em vez de deixar o relógio torto.
function aoSair() {
  if (gravMic) gravMic.parar(true);
  if (gravAudio) pararGravacaoAudio();
  pararPrevia();
  if (T.grav || T.tocando) pararTudo();
  salvarCfg();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) aoSair();
  else if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
});
window.addEventListener('pagehide', aoSair);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();

// Para os testes automáticos.
window.__batuque = { T, cfg, get ctx() { return ctx; }, apertarRec, apertarPlay, apertarClear, apertarLoop, mudarBpm };
