// Vozes sintetizadas. Cada uma recebe (ctx, saida, quando, p, r) — r é o
// multiplicador de afinação do pad — e devolve o instante em que termina.
// Funciona igual no AudioContext ao vivo e no OfflineAudioContext da exportação.

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

const ruidos = new WeakMap();
function bufferRuido(ctx) {
  let b = ruidos.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ruidos.set(ctx, b);
  }
  return b;
}

function ruido(ctx, q, dur) {
  const s = ctx.createBufferSource();
  s.buffer = bufferRuido(ctx);
  s.start(q, Math.random() * 0.4);
  s.stop(q + Math.min(dur, 2.5) + 0.05);
  return s;
}

function osc(ctx, tipo, f, q, fim) {
  const o = ctx.createOscillator();
  o.type = tipo;
  o.frequency.setValueAtTime(f, q);
  o.start(q);
  o.stop(fim + 0.05);
  return o;
}

function ganho(ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function filtro(ctx, tipo, f, Q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = tipo;
  b.frequency.value = f;
  b.Q.value = Q;
  return b;
}

// Envelope de volume: sobe em `ataque`, cai exponencialmente em `decay`.
function env(param, q, ataque, pico, decay) {
  param.setValueAtTime(0, q);
  param.linearRampToValueAtTime(pico, q + ataque);
  param.exponentialRampToValueAtTime(0.0001, q + ataque + decay);
  param.setValueAtTime(0, q + ataque + decay + 0.001);
  return q + ataque + decay;
}

const curvas = new Map();
function curvaSaturacao(k) {
  const chave = Math.round(k * 100);
  let c = curvas.get(chave);
  if (!c) {
    c = new Float32Array(1024);
    const norm = Math.tanh(k);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    curvas.set(chave, c);
  }
  return c;
}

function saturar(ctx, drive) {
  const w = ctx.createWaveShaper();
  w.curve = curvaSaturacao(1 + drive * 5);
  return w;
}

// Pancada curta de ruído agudo — o "tic" do ataque.
function clique(ctx, out, q, nivel, freq = 2500, decay = 0.012) {
  if (!(nivel > 0)) return q;
  const n = ruido(ctx, q, decay + 0.02);
  const hp = filtro(ctx, 'highpass', freq);
  const g = ganho(ctx, 0);
  n.connect(hp).connect(g).connect(out);
  return env(g.gain, q, 0.0008, nivel * 0.5, decay);
}

// Os 6 osciladores quadrados do chimbal da 808.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

export const VOZES = {
  kick(ctx, out, q, p, r) {
    const { f0 = 150, f1 = 48, sweep = 0.06, decay = 0.4, click = 0.5, drive = 0 } = p;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.002, 1, decay);
    const o = osc(ctx, 'sine', f0 * r, q, fim);
    o.frequency.exponentialRampToValueAtTime(f1 * r, q + sweep);
    if (drive > 0) o.connect(g).connect(saturar(ctx, drive)).connect(out);
    else o.connect(g).connect(out);
    clique(ctx, out, q, click);
    return fim;
  },

  b808(ctx, out, q, p, r) {
    const { nota = 37, decay = 1.4, drive = 0.5, slide = 0 } = p;
    const f = mtof(nota) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.004, 1, decay);
    const o = osc(ctx, 'sine', f * (slide ? 2 : 1.7), q, fim);
    o.frequency.exponentialRampToValueAtTime(f, q + (slide || 0.035));
    o.connect(g).connect(saturar(ctx, drive)).connect(out);
    clique(ctx, out, q, 0.25, 1500);
    return fim;
  },

  snare(ctx, out, q, p, r) {
    const { tom = 190, decayTom = 0.1, decayRuido = 0.2, corte = 1500, ruido: nr = 1 } = p;
    const gt = ganho(ctx, 0);
    const fimT = env(gt.gain, q, 0.001, 0.7, decayTom);
    const o = osc(ctx, 'triangle', tom * r, q, fimT);
    o.frequency.exponentialRampToValueAtTime(tom * r * 0.75, q + 0.05);
    o.connect(gt).connect(out);
    const gn = ganho(ctx, 0);
    const fimN = env(gn.gain, q, 0.001, nr * 0.75, decayRuido);
    ruido(ctx, q, decayRuido + 0.05).connect(filtro(ctx, 'highpass', corte * r)).connect(gn).connect(out);
    return Math.max(fimT, fimN);
  },

  clap(ctx, out, q, p, r) {
    const { freq = 1200, decay = 0.22 } = p;
    const g = ganho(ctx, 0);
    const a = g.gain;
    a.setValueAtTime(0, q);
    for (let i = 0; i < 3; i++) {
      const t = q + i * 0.011;
      a.setValueAtTime(1, t);
      a.exponentialRampToValueAtTime(0.08, t + 0.009);
    }
    const t = q + 0.033;
    a.setValueAtTime(0.85, t);
    a.exponentialRampToValueAtTime(0.0001, t + decay);
    a.setValueAtTime(0, t + decay + 0.001);
    ruido(ctx, q, decay + 0.1).connect(filtro(ctx, 'bandpass', freq * r, 0.9)).connect(g).connect(out);
    return t + decay;
  },

  // Chimbal, ride e prato: metal da 808 + ruído.
  hat(ctx, out, q, p, r) {
    const { decay = 0.05, corte = 7000, escala = 1, ruido: nr = 0 } = p;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.001, 0.9, decay);
    const soma = ganho(ctx, 0.25);
    for (const f of METAL) osc(ctx, 'square', f * escala * r, q, fim).connect(soma);
    const bp = filtro(ctx, 'bandpass', 10000, 0.8);
    const hp = filtro(ctx, 'highpass', corte);
    soma.connect(bp).connect(hp).connect(g).connect(out);
    if (nr > 0) {
      const gn = ganho(ctx, nr);
      ruido(ctx, q, decay + 0.05).connect(filtro(ctx, 'highpass', corte)).connect(gn).connect(g);
    }
    return fim;
  },

  tom(ctx, out, q, p, r) {
    const { f = 120, decay = 0.3, click = 0.3 } = p;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.002, 1, decay);
    const o = osc(ctx, 'sine', f * r * 1.6, q, fim);
    o.frequency.exponentialRampToValueAtTime(f * r, q + Math.min(0.12, decay * 0.5));
    o.connect(g).connect(out);
    clique(ctx, out, q, click, 1800);
    return fim;
  },

  rim(ctx, out, q, p, r) {
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.0005, 0.8, 0.03);
    osc(ctx, 'triangle', 1700 * r, q, fim).connect(filtro(ctx, 'highpass', 600)).connect(g).connect(out);
    const gn = ganho(ctx, 0);
    env(gn.gain, q, 0.0005, 0.5, 0.02);
    ruido(ctx, q, 0.05).connect(filtro(ctx, 'bandpass', 3000 * r, 1.5)).connect(gn).connect(out);
    return fim;
  },

  cowbell(ctx, out, q, p, r) {
    const { f = 800, decay = 0.35 } = p;
    const g = ganho(ctx, 0);
    const a = g.gain;
    a.setValueAtTime(0, q);
    a.linearRampToValueAtTime(0.8, q + 0.001);
    a.exponentialRampToValueAtTime(0.25, q + 0.05);
    a.exponentialRampToValueAtTime(0.0001, q + decay);
    a.setValueAtTime(0, q + decay + 0.001);
    const soma = ganho(ctx, 0.5);
    osc(ctx, 'square', f * r * 0.665, q, q + decay).connect(soma);
    osc(ctx, 'square', f * r, q, q + decay).connect(soma);
    soma.connect(filtro(ctx, 'bandpass', f * r * 1.1, 1.5)).connect(g).connect(out);
    return q + decay;
  },

  shaker(ctx, out, q, p, r) {
    const { freq = 6500, decay = 0.09, ataque = 0.012 } = p;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, ataque, 0.9, decay);
    ruido(ctx, q, ataque + decay + 0.05).connect(filtro(ctx, 'bandpass', freq * r, 1.2)).connect(g).connect(out);
    return fim;
  },

  conga(ctx, out, q, p, r) {
    const { f = 280, decay = 0.22 } = p;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.001, 1, decay);
    const o = osc(ctx, 'sine', f * r * 1.15, q, fim);
    o.frequency.exponentialRampToValueAtTime(f * r, q + 0.04);
    o.connect(g).connect(out);
    clique(ctx, out, q, 0.25, 1500, 0.006);
    return fim;
  },

  snap(ctx, out, q, p, r) {
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.0005, 1, 0.07);
    ruido(ctx, q, 0.1).connect(filtro(ctx, 'bandpass', 2100 * r, 2)).connect(g).connect(out);
    const gs = ganho(ctx, 0);
    env(gs.gain, q, 0.0005, 0.3, 0.012);
    osc(ctx, 'sine', 1800 * r, q, q + 0.02).connect(gs).connect(out);
    return fim;
  },

  // FM de 2 operadores: percussão metálica, madeira, sino.
  fm(ctx, out, q, p, r) {
    const { f: f0 = 600, nota, razao = 1.5, indice = 3, decay = 0.15 } = p;
    const f = (nota !== undefined ? mtof(nota) : f0) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.001, 0.8, decay);
    const car = osc(ctx, 'sine', f, q, fim);
    const mod = osc(ctx, 'sine', f * razao, q, fim);
    const gm = ganho(ctx, 0);
    gm.gain.setValueAtTime(f * indice, q);
    gm.gain.exponentialRampToValueAtTime(Math.max(1, f * indice * 0.02), fim);
    mod.connect(gm).connect(car.frequency);
    car.connect(g).connect(out);
    return fim;
  },

  sino(ctx, out, q, p, r) {
    return VOZES.fm(ctx, out, q, { nota: p.nota, razao: 3.5, indice: 2.2, decay: p.decay || 1.6 }, r);
  },

  cuica(ctx, out, q, p, r) {
    const { f = 420 } = p;
    const fim = q + 0.32;
    const g = ganho(ctx, 0);
    const a = g.gain;
    a.setValueAtTime(0, q);
    a.linearRampToValueAtTime(0.8, q + 0.02);
    a.setValueAtTime(0.8, q + 0.12);
    a.exponentialRampToValueAtTime(0.0001, fim);
    a.setValueAtTime(0, fim + 0.001);
    const o = osc(ctx, 'triangle', f * r * 0.6, q, fim);
    o.frequency.linearRampToValueAtTime(f * r * 1.3, q + 0.08);
    o.frequency.linearRampToValueAtTime(f * r * 0.85, q + 0.28);
    o.connect(filtro(ctx, 'lowpass', 2500)).connect(g).connect(out);
    return fim;
  },

  apito(ctx, out, q, p, r) {
    const { f = 2300, dur = 0.24 } = p;
    const fim = q + dur + 0.06;
    const g = ganho(ctx, 0);
    const a = g.gain;
    a.setValueAtTime(0, q);
    a.linearRampToValueAtTime(0.35, q + 0.012);
    a.setValueAtTime(0.35, q + dur);
    a.exponentialRampToValueAtTime(0.0001, fim);
    a.setValueAtTime(0, fim + 0.001);
    const o = osc(ctx, 'sine', f * r, q, fim);
    const lfo = osc(ctx, 'sine', 26, q, fim);
    const prof = ganho(ctx, f * r * 0.04);
    lfo.connect(prof).connect(o.frequency);
    o.connect(g).connect(out);
    const gs = ganho(ctx, 0.25);
    ruido(ctx, q, dur + 0.1).connect(filtro(ctx, 'bandpass', f * r, 4)).connect(gs).connect(g);
    return fim;
  },

  baixo(ctx, out, q, p, r) {
    const { nota = 36, onda = 'sawtooth', corte = 400, env: envF = 1200, decay = 0.5, sub = 0.5 } = p;
    const f = mtof(nota) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.003, 0.9, decay);
    const lp = filtro(ctx, 'lowpass', corte + envF, 2);
    lp.frequency.setValueAtTime(corte + envF, q);
    lp.frequency.exponentialRampToValueAtTime(corte, q + decay * 0.6);
    osc(ctx, onda, f, q, fim).connect(lp);
    const gs = ganho(ctx, sub);
    osc(ctx, 'sine', f / 2, q, fim).connect(gs).connect(g);
    lp.connect(g).connect(out);
    return fim;
  },

  // Piano elétrico em FM.
  teclas(ctx, out, q, p, r) {
    const { nota = 60, decay = 1.5 } = p;
    const f = mtof(nota) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.002, 0.6, decay);
    const car = osc(ctx, 'sine', f, q, fim);
    const mod = osc(ctx, 'sine', f, q, fim);
    const gm = ganho(ctx, 0);
    gm.gain.setValueAtTime(f * 1.4, q);
    gm.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.08), q + 0.9);
    mod.connect(gm).connect(car.frequency);
    car.connect(g).connect(out);
    return fim;
  },

  stab(ctx, out, q, p, r) {
    const { nota = 60, decay = 0.3 } = p;
    const f = mtof(nota) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.002, 0.4, decay);
    const lp = filtro(ctx, 'lowpass', 2600, 1);
    osc(ctx, 'square', f, q, fim).connect(lp);
    const o2 = osc(ctx, 'sawtooth', f, q, fim);
    o2.detune.value = 7;
    o2.connect(lp);
    lp.connect(g).connect(out);
    return fim;
  },

  pluck(ctx, out, q, p, r) {
    const { nota = 69, decay = 0.5 } = p;
    const f = mtof(nota) * r;
    const g = ganho(ctx, 0);
    const fim = env(g.gain, q, 0.002, 0.5, decay);
    const lp = filtro(ctx, 'lowpass', 5000, 3);
    lp.frequency.setValueAtTime(5000, q);
    lp.frequency.exponentialRampToValueAtTime(400, q + 0.25);
    osc(ctx, 'sawtooth', f, q, fim).connect(lp);
    const o2 = osc(ctx, 'sawtooth', f, q, fim);
    o2.detune.value = 9;
    o2.connect(lp);
    lp.connect(g).connect(out);
    return fim;
  },

  acorde(ctx, out, q, p, r) {
    const { instr = 'teclas', notas = [60, 64, 67] } = p;
    const g = ganho(ctx, 1 / notas.length ** 0.6);
    g.connect(out);
    let fim = q;
    notas.forEach((nota, i) => {
      // As notas entram com uma diferença mínima, como dedos de verdade.
      fim = Math.max(fim, VOZES[instr](ctx, g, q + i * 0.004, { nota }, r));
    });
    return fim;
  },
};

// Clique do metrônomo.
export function vozClique(ctx, out, q, forte) {
  const g = ganho(ctx, 0);
  const fim = env(g.gain, q, 0.0005, forte ? 0.55 : 0.35, 0.03);
  osc(ctx, 'square', forte ? 1600 : 1100, q, fim).connect(filtro(ctx, 'lowpass', 4000)).connect(g).connect(out);
  return fim;
}
