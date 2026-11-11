// Motor de áudio: efeitos (reverb, delay, distorção), limitador e a função que
// dispara um pad. O mesmo motor roda no AudioContext ao vivo e num
// OfflineAudioContext para gerar o WAV.

import { VOZES, vozClique } from './synth.js';

function impulso(ctx, seg = 2.2, queda = 3) {
  const len = Math.round(ctx.sampleRate * seg);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  const pre = Math.round(ctx.sampleRate * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** queda;
  }
  return b;
}

const curvaDist = (amt) => {
  const k = 2 + amt * 60;
  const c = new Float32Array(2048);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
};

// A curva cobre a entrada de -4 a 4 (o WaveShaper só aceita -1..1, por isso o
// ganho de 0,25 antes dele).
export function limitar(u) {
  const a = Math.abs(u);
  if (a <= 0.6) return u;
  return Math.sign(u) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
}
function curvaLimite() {
  const c = new Float32Array(4097);
  for (let i = 0; i < c.length; i++) c[i] = limitar(((i / (c.length - 1)) * 2 - 1) * 4);
  return c;
}

export class Motor {
  constructor(ctx, { vivo = true } = {}) {
    this.ctx = ctx;
    this.vivo = vivo;
    this.grupos = new Map();
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.entrada = g(1);
    this.distSeco = g(1);
    this.distMolhado = g(0);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.pos = g(1);
    this.entrada.connect(this.distSeco).connect(this.pos);
    this.entrada.connect(this.shaper).connect(this.distMolhado).connect(this.pos);

    this.mestre = g(0.9);
    this.pos.connect(this.mestre);

    this.revEnvio = g(0);
    this.conv = ctx.createConvolver();
    this.conv.buffer = impulso(ctx);
    this.pos.connect(this.revEnvio).connect(this.conv).connect(this.mestre);

    this.delEnvio = g(0);
    this.delay = ctx.createDelay(2);
    this.delRetorno = g(0);
    const tom = ctx.createBiquadFilter();
    tom.type = 'lowpass';
    tom.frequency.value = 3500;
    this.pos.connect(this.delEnvio).connect(this.delay);
    this.delay.connect(tom).connect(this.delRetorno).connect(this.delay);
    tom.connect(this.mestre);

    // O metrônomo não passa pelos efeitos nem entra na gravação do som.
    this.direto = g(0.8);

    // Saturação suave no fim em vez de compressor: até 0,6 passa reto, acima
    // disso arredonda até no máximo 1. Nunca estoura e não abaixa o volume
    // (o compressor do Safari derruba uns 8 dB de tudo).
    this.preLim = g(0.25);
    this.lim = ctx.createWaveShaper();
    this.lim.curve = curvaLimite();
    this.lim.oversample = '2x';
    this.volumeGeral = g(1);
    this.mestre.connect(this.preLim).connect(this.lim).connect(this.volumeGeral).connect(ctx.destination);
    this.direto.connect(this.volumeGeral);
  }

  _p(param, v) {
    if (this.vivo) param.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    else param.setValueAtTime(v, 0);
  }

  // fx: { reverb, delay, dist } de 0 a 1.
  efeitos({ reverb = 0, delay = 0, dist = 0 }, bpm = 120) {
    this._p(this.revEnvio.gain, reverb * 0.9);
    this._p(this.delEnvio.gain, delay * 0.75);
    this._p(this.delRetorno.gain, delay > 0 ? 0.2 + delay * 0.45 : 0);
    const tempo = Math.min(1.9, (60 / bpm) * 0.75); // colcheia pontuada
    this._p(this.delay.delayTime, tempo);
    if (dist > 0) {
      if (this._distCurva !== Math.round(dist * 100)) {
        this._distCurva = Math.round(dist * 100);
        this.shaper.curve = curvaDist(dist);
      }
    }
    const m = Math.min(1, dist * 1.4);
    this._p(this.distSeco.gain, 1 - m);
    this._p(this.distMolhado.gain, m * (0.55 - dist * 0.15));
  }

  volume(v) { this._p(this.volumeGeral.gain, v); }

  // Dispara um som. ajuste = { vol, afin } do pad; buffer = amostra do usuário.
  // grupoAmostra: com amostra, um toque novo no mesmo pad corta o anterior.
  // Devolve um controle para silenciar antes da hora (choke e parar o play).
  tocar(som, quando, ajuste = {}, buffer = null, grupoAmostra = null) {
    const ctx = this.ctx;
    const vol = ajuste.vol ?? 1;
    const r = 2 ** ((ajuste.afin || 0) / 12);
    const vca = ctx.createGain();
    let destino = this.entrada;
    let lp = null;
    if (som.filtro && !buffer) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = som.filtro;
      lp.connect(destino);
      destino = lp;
    }
    vca.connect(destino);
    const pre = ctx.createGain();
    pre.gain.value = vol * (buffer ? 0.9 : som.nivel ?? 1);
    pre.connect(vca);

    let fim;
    if (buffer) {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.playbackRate.value = r;
      s.connect(pre);
      s.start(quando);
      fim = quando + buffer.duration / r;
    } else {
      fim = VOZES[som.tipo](ctx, pre, quando, som.p || {}, r);
    }

    const voz = {
      inicio: quando,
      fim,
      paradaEm: Infinity,
      parar(t) {
        if (t >= this.paradaEm || t >= this.fim) return;
        this.paradaEm = t;
        vca.gain.cancelScheduledValues(t);
        vca.gain.setValueAtTime(1, t);
        vca.gain.linearRampToValueAtTime(0, t + 0.012);
      },
    };

    const grupo = buffer ? grupoAmostra : som.grupo;
    if (grupo) {
      const lista = (this.grupos.get(grupo) || []).filter((v) => v.fim > quando);
      for (const v of lista) if (v.inicio <= quando) v.parar(quando);
      lista.push(voz);
      this.grupos.set(grupo, lista);
    }

    if (this.vivo) {
      const ms = (fim - ctx.currentTime + 0.5) * 1000;
      setTimeout(() => { try { vca.disconnect(); if (lp) lp.disconnect(); } catch {} }, Math.max(0, ms));
    }
    return voz;
  }

  clique(quando, forte) {
    const g = this.ctx.createGain();
    g.connect(this.direto);
    const fim = vozClique(this.ctx, g, quando, forte);
    return {
      inicio: quando,
      fim,
      parar(t) {
        if (t >= fim) return;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
      },
    };
  }
}
