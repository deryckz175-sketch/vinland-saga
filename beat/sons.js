// Os pacotes de sons. Tudo é sintetizado na hora (synth.js), então o app não
// baixa nenhuma amostra e funciona sem internet.
//
// Cada pacote tem 2 bancos de 16 pads (o botão ● ○ troca):
//   banco A (pads 0–15): bateria e percussão;
//   banco B (pads 16–31): 2 fileiras de acordes ou melodia em cima,
//                         2 fileiras de baixo embaixo, tudo no tom do pacote.

const NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const nomeNota = (midi) => NOMES[((midi % 12) + 12) % 12];

export const ESCALAS = {
  menor: [0, 2, 3, 5, 7, 8, 10],
  menorHarmonica: [0, 2, 3, 5, 7, 8, 11],
  dorico: [0, 2, 3, 5, 7, 9, 10],
  maior: [0, 2, 4, 5, 7, 9, 11],
};

export const grau = (escala, raiz, i) => raiz + escala[i % 7] + 12 * Math.floor(i / 7);

export function notasDoAcorde(escala, raiz, i, setima) {
  const n = [grau(escala, raiz, i), grau(escala, raiz, i + 2), grau(escala, raiz, i + 4)];
  if (setima) n.push(grau(escala, raiz, i + 6));
  return n;
}

export function nomeAcorde(notas) {
  const [a, b, c, d] = notas;
  const terca = b - a;
  const quinta = c - a;
  const r = nomeNota(a);
  let q = terca === 3 ? (quinta === 6 ? 'dim' : 'm') : quinta === 8 ? 'aug' : '';
  if (d === undefined) return r + (q === 'dim' ? '°' : q === 'aug' ? '+' : q);
  const s = d - a;
  if (q === 'dim') return r + (s === 9 ? '°7' : 'm7♭5');
  if (q === 'm') return r + (s === 11 ? 'mMaj7' : 'm7');
  if (q === 'aug') return r + '+maj7';
  return r + (s === 11 ? 'maj7' : '7');
}

// Kits de bateria: [nome, tipo, parâmetros, extras]
const k = (nome, tipo, p = {}, extra = {}) => ({ nome, tipo, p, ...extra });
const HAT = { grupo: 'hat' };

const KITS = {
  trap: [
    k('Kick', 'kick', { f0: 150, f1: 46, sweep: 0.06, decay: 0.38, click: 0.6 }),
    k('Kick 2', 'kick', { f0: 210, f1: 55, sweep: 0.04, decay: 0.22, click: 1, drive: 0.5 }),
    k('Snare', 'snare', { tom: 205, decayTom: 0.09, decayRuido: 0.18, corte: 2000, ruido: 1 }),
    k('Clap', 'clap', { freq: 1300, decay: 0.22 }),
    k('Hat', 'hat', { decay: 0.045 }, HAT),
    k('Hat 2', 'hat', { decay: 0.025, escala: 1.15 }, HAT),
    k('Open', 'hat', { decay: 0.32 }, HAT),
    k('Rim', 'rim'),
    k('Snap', 'snap'),
    k('Perc', 'fm', { f: 620, razao: 1.48, indice: 3, decay: 0.12 }),
    k('Tom', 'tom', { f: 110, decay: 0.3 }),
    k('Tom 2', 'tom', { f: 165, decay: 0.25 }),
    k('Crash', 'hat', { decay: 1.4, corte: 5000, ruido: 0.5 }, { nivel: 0.5 }),
    k('Shaker', 'shaker'),
    k('808', 'b808', { nota: 37, decay: 1.4, drive: 0.5 }, { grupo: '808' }),
    k('808 Slide', 'b808', { nota: 37, decay: 2.2, drive: 0.4, slide: 0.18 }, { grupo: '808' }),
  ],
  boombap: [
    k('Kick', 'kick', { f0: 120, f1: 50, sweep: 0.05, decay: 0.32, click: 0.8, drive: 0.3 }),
    k('Kick 2', 'kick', { f0: 100, f1: 45, sweep: 0.06, decay: 0.45, click: 0.4 }),
    k('Snare', 'snare', { tom: 180, decayTom: 0.12, decayRuido: 0.25, corte: 1200, ruido: 1.1 }),
    k('Snare 2', 'snare', { tom: 230, decayTom: 0.08, decayRuido: 0.15, corte: 2500, ruido: 0.9 }),
    k('Clap', 'clap', { freq: 1100, decay: 0.2 }),
    k('Hat', 'hat', { decay: 0.05, corte: 6000 }, HAT),
    k('Hat 2', 'hat', { decay: 0.08, corte: 5000 }, HAT),
    k('Open', 'hat', { decay: 0.25 }, HAT),
    k('Rim', 'rim'),
    k('Shaker', 'shaker', { decay: 0.12 }),
    k('Ride', 'hat', { decay: 1.0, corte: 5000, escala: 0.9, ruido: 0.2 }, { nivel: 0.7 }),
    k('Crash', 'hat', { decay: 1.6, corte: 4500, ruido: 0.6 }, { nivel: 0.5 }),
    k('Tom', 'tom', { f: 90, decay: 0.35 }),
    k('Conga', 'conga', { f: 240 }),
    k('Cowbell', 'cowbell', { f: 800 }),
    k('Snap', 'snap'),
  ],
  funk: [
    k('Kick', 'kick', { f0: 170, f1: 52, sweep: 0.05, decay: 0.3, click: 1, drive: 0.6 }),
    k('Tamborzão', 'tom', { f: 95, decay: 0.4, click: 0.6 }),
    k('Tambor', 'tom', { f: 140, decay: 0.3, click: 0.6 }),
    k('Palma', 'clap', { freq: 1500, decay: 0.18 }),
    k('Caixa', 'snare', { tom: 210, decayTom: 0.08, decayRuido: 0.16, corte: 1800, ruido: 1 }),
    k('Chimbal', 'hat', { decay: 0.04 }, HAT),
    k('Chimbal ab.', 'hat', { decay: 0.28 }, HAT),
    k('Atabaque', 'conga', { f: 200, decay: 0.28 }),
    k('Conga', 'conga', { f: 310 }),
    k('Agogô', 'cowbell', { f: 900 }),
    k('Agogô 2', 'cowbell', { f: 660 }),
    k('Cuíca', 'cuica', { f: 420 }),
    k('Cuíca 2', 'cuica', { f: 620 }),
    k('Apito', 'apito', { f: 2300 }),
    k('Pandeiro', 'shaker', { freq: 7500, decay: 0.16, ataque: 0.004 }),
    k('808', 'b808', { nota: 45, decay: 0.7, drive: 0.6 }, { grupo: '808' }),
  ],
  house: [
    k('Kick', 'kick', { f0: 180, f1: 50, sweep: 0.035, decay: 0.4, click: 0.7 }),
    k('Kick 2', 'kick', { f0: 130, f1: 48, sweep: 0.05, decay: 0.5, click: 0.3 }),
    k('Clap', 'clap', { freq: 1200, decay: 0.3 }),
    k('Snare', 'snare', { tom: 190, decayTom: 0.1, decayRuido: 0.2, corte: 1500, ruido: 1 }),
    k('Hat', 'hat', { decay: 0.04 }, HAT),
    k('Open', 'hat', { decay: 0.22 }, HAT),
    k('Ride', 'hat', { decay: 1.2, corte: 6000, escala: 0.85, ruido: 0.15 }, { nivel: 0.7 }),
    k('Shaker', 'shaker'),
    k('Rim', 'rim'),
    k('Conga', 'conga', { f: 260 }),
    k('Conga 2', 'conga', { f: 350 }),
    k('Cowbell', 'cowbell', { f: 800 }),
    k('Tom', 'tom', { f: 130, decay: 0.3 }),
    k('Crash', 'hat', { decay: 1.5, corte: 5000, ruido: 0.5 }, { nivel: 0.5 }),
    k('Perc', 'fm', { f: 400, razao: 2.01, indice: 2.5, decay: 0.15 }),
    k('Snap', 'snap'),
  ],
  lofi: [
    k('Kick', 'kick', { f0: 110, f1: 45, sweep: 0.06, decay: 0.35, click: 0.2 }),
    k('Kick 2', 'kick', { f0: 95, f1: 42, sweep: 0.07, decay: 0.42, click: 0.1, drive: 0.4 }),
    k('Snare', 'snare', { tom: 175, decayTom: 0.1, decayRuido: 0.22, corte: 900, ruido: 1 }),
    k('Rim', 'rim'),
    k('Clap', 'clap', { freq: 900, decay: 0.2 }),
    k('Hat', 'hat', { decay: 0.06, corte: 4000 }, HAT),
    k('Hat 2', 'hat', { decay: 0.035, corte: 4500, escala: 1.1 }, HAT),
    k('Open', 'hat', { decay: 0.3, corte: 4000 }, HAT),
    k('Shaker', 'shaker', { freq: 5000, decay: 0.14 }),
    k('Conga', 'conga', { f: 220 }),
    k('Tom', 'tom', { f: 100, decay: 0.32 }),
    k('Ride', 'hat', { decay: 1.0, corte: 4000, escala: 0.9, ruido: 0.2 }, { nivel: 0.7 }),
    k('Snap', 'snap'),
    k('Toc', 'fm', { f: 800, razao: 3.5, indice: 1.5, decay: 0.08 }),
    k('Sino', 'fm', { f: 1046, razao: 3.5, indice: 2, decay: 0.9 }),
    k('Crash', 'hat', { decay: 1.4, corte: 3500, ruido: 0.5 }, { nivel: 0.5 }),
  ],
  synth: [
    k('Kick', 'kick', { f0: 160, f1: 50, sweep: 0.05, decay: 0.4, click: 0.5 }),
    k('Kick 2', 'kick', { f0: 220, f1: 60, sweep: 0.03, decay: 0.25, click: 0.8, drive: 0.4 }),
    k('Snare', 'snare', { tom: 190, decayTom: 0.15, decayRuido: 0.35, corte: 1000, ruido: 1.1 }),
    k('Clap', 'clap', { freq: 1200, decay: 0.35 }),
    k('Hat', 'hat', { decay: 0.05 }, HAT),
    k('Open', 'hat', { decay: 0.3 }, HAT),
    k('Tom 1', 'tom', { f: 80, decay: 0.45, click: 0.3 }),
    k('Tom 2', 'tom', { f: 120, decay: 0.4, click: 0.3 }),
    k('Tom 3', 'tom', { f: 170, decay: 0.35, click: 0.3 }),
    k('Crash', 'hat', { decay: 1.6, corte: 5000, ruido: 0.5 }, { nivel: 0.5 }),
    k('Ride', 'hat', { decay: 1.1, corte: 6000, escala: 0.85, ruido: 0.15 }, { nivel: 0.7 }),
    k('Shaker', 'shaker'),
    k('Rim', 'rim'),
    k('Snap', 'snap'),
    k('Cowbell', 'cowbell', { f: 720 }),
    k('Zap', 'fm', { f: 900, razao: 0.5, indice: 6, decay: 0.18 }),
  ],
};

// A parte melódica de cada pacote.
//   cima: 'acorde' (8 acordes do campo harmônico) ou 'nota' (8 notas da escala)
//   baixo: instrumento das 8 notas de baixo
const MELODIA = {
  trap: { raiz: 37, escala: 'menorHarmonica', cima: 'nota', instrCima: 'sino', oitavaCima: 3, baixo: 'b808', pBaixo: { decay: 1.6, drive: 0.5 } },
  boombap: { raiz: 38, escala: 'dorico', cima: 'acorde', setima: true, instrCima: 'teclas', oitavaCima: 2, baixo: 'baixo', pBaixo: { onda: 'triangle', corte: 600, env: 400, decay: 0.6, sub: 0.6 } },
  funk: { raiz: 33, escala: 'menor', cima: 'acorde', instrCima: 'stab', oitavaCima: 3, baixo: 'b808', pBaixo: { decay: 0.6, drive: 0.7 }, oitavaBaixo: 1 },
  house: { raiz: 41, escala: 'menor', cima: 'acorde', setima: true, instrCima: 'stab', oitavaCima: 2, baixo: 'baixo', pBaixo: { onda: 'sawtooth', corte: 300, env: 1500, decay: 0.35, sub: 0.5 } },
  lofi: { raiz: 39, escala: 'maior', cima: 'acorde', setima: true, instrCima: 'teclas', oitavaCima: 2, baixo: 'baixo', pBaixo: { onda: 'triangle', corte: 500, env: 300, decay: 0.7, sub: 0.7 } },
  synth: { raiz: 45, escala: 'menor', cima: 'nota', instrCima: 'pluck', oitavaCima: 2, baixo: 'baixo', pBaixo: { onda: 'sawtooth', corte: 250, env: 2200, decay: 0.4, sub: 0.4 } },
};

export const PACOTES = [
  { id: 'trap', nome: 'Trap', cor: '#e5342b', bpm: 140, desc: '808 grave, hats rápidos e sinos em C# menor.' },
  { id: 'funk', nome: 'Funk BR', cor: '#22c55e', bpm: 130, desc: 'Tamborzão, atabaque, cuíca, agogô e apito em A menor.' },
  { id: 'boombap', nome: 'Boom Bap', cor: '#f59e0b', bpm: 90, desc: 'Bateria seca de rap anos 90 e piano elétrico em D.' },
  { id: 'house', nome: 'House', cor: '#3b82f6', bpm: 124, desc: 'Kick reto, clap, ride e acordes de órgão em F menor.' },
  { id: 'lofi', nome: 'Lo-fi', cor: '#a78bfa', bpm: 82, desc: 'Tudo abafado, acordes maj7 em E♭ para estudar.' },
  { id: 'synth', nome: 'Synthwave', cor: '#ec4899', bpm: 110, desc: 'Toms eletrônicos, snare enorme e pluck em A menor.' },
].map((p) => ({ ...p, filtro: p.id === 'lofi' ? 6000 : null }));

export const pacotePorId = (id) => PACOTES.find((p) => p.id === id) || PACOTES[0];

// Acerto de volume por tipo de som, medido renderizando cada pad.
const NIVEL_TIPO = { hat: 2.2, clap: 1.6, snap: 1.6, snare: 0.75, b808: 0.75, apito: 1.5, pluck: 0.65 };

const cache = new Map();

function melodicos(id) {
  const m = MELODIA[id];
  const esc = ESCALAS[m.escala];
  const cima = [];
  const raizCima = m.raiz + 12 * m.oitavaCima;
  for (let i = 0; i < 8; i++) {
    if (m.cima === 'acorde') {
      const notas = notasDoAcorde(esc, raizCima, i, m.setima);
      cima.push({ nome: nomeAcorde(notas), tipo: 'acorde', p: { instr: m.instrCima, notas } });
    } else {
      const nota = grau(esc, raizCima, i);
      cima.push({ nome: nomeNota(nota), tipo: m.instrCima, p: { nota } });
    }
  }
  const baixo = [];
  const raizBaixo = m.raiz + 12 * (m.oitavaBaixo || 0);
  for (let i = 0; i < 8; i++) {
    const nota = grau(esc, raizBaixo, i);
    baixo.push({
      nome: `${nomeNota(nota)} ${m.baixo === 'b808' ? '808' : 'Baixo'}`,
      tipo: m.baixo,
      p: { ...m.pBaixo, nota },
      grupo: m.baixo === 'b808' ? '808' : 'baixo',
    });
  }
  return [...cima, ...baixo];
}

// Som do pad 0–31 de um pacote: { nome, tipo, p, grupo?, filtro? }
export function somDoPad(pacoteId, pad) {
  const chave = `${pacoteId}:${pad}`;
  if (cache.has(chave)) return cache.get(chave);
  const pac = pacotePorId(pacoteId);
  const lista = pad < 16 ? KITS[pac.id] : melodicos(pac.id);
  const base = lista[pad % 16];
  const som = {
    ...base,
    nivel: (NIVEL_TIPO[base.tipo] ?? 1) * (base.nivel ?? 1),
    filtro: pac.filtro,
    grupo: base.grupo ? `${pac.id}:${base.grupo}` : null,
  };
  cache.set(chave, som);
  return som;
}
