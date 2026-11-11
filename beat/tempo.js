// Contas de tempo do gravador. Sem nada de navegador aqui: só números,
// para poder testar com `node beat/check.mjs`.
//
// Um "take" é { bpm, dur, eventos: [{ t, pacote, pad, camada }] }, com t em
// segundos a partir do início do loop (0 <= t < dur). Compasso 4/4.

export const batida = (bpm) => 60 / bpm;
export const compasso = (bpm) => 240 / bpm;
export const passo = (bpm) => 15 / bpm; // semicolcheia (1/16)

export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const limitarBpm = (b) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number(b) || 120)));

const EPS = 1e-6;

// Coloca um toque (segundos desde o início do loop, podendo já ter dado voltas)
// dentro do loop. `ciclo` diz em que volta ele caiu — o agendador usa isso para
// não tocar de novo, na mesma volta, um toque que acabou de soar ao vivo.
export function posicionar(rel, dur, bpm, ajustar) {
  let t = Math.max(0, rel);
  if (ajustar) t = Math.round(t / passo(bpm)) * passo(bpm);
  let ciclo = Math.floor(t / dur + EPS);
  t -= ciclo * dur;
  if (t < EPS) t = 0;
  if (t >= dur - EPS) { t = 0; ciclo += 1; }
  return { t, ciclo };
}

// Fecha a primeira gravação. Com `ajustar`, o tamanho vira um número inteiro
// de compassos (o mais perto de onde se apertou parar) e os toques vão para a
// grade de semicolcheias.
export function fecharTake(toques, durBruta, bpm, ajustar) {
  const c = compasso(bpm);
  const dur = ajustar ? Math.max(1, Math.round(durBruta / c)) * c : Math.max(0.25, durBruta);
  const eventos = toques.map((x) => {
    const { t, ciclo } = posicionar(x.t, dur, bpm, ajustar);
    return { t, pacote: x.pacote, pad: x.pad, camada: 0, _ciclo: ciclo };
  });
  return { dur, eventos: ordenar(eventos) };
}

export const ordenar = (eventos) => eventos.sort((a, b) => a.t - b.t);

// Todos os toques que caem em [de, ate), no relógio do áudio, para um loop que
// começou em `inicio`. Pula o toque na volta em que ele foi gravado.
export function eventosNaJanela(eventos, inicio, dur, de, ate) {
  const saida = [];
  if (!(ate > de) || !(dur > 0)) return saida;
  const kIni = Math.max(0, Math.floor((de - inicio) / dur));
  const kFim = Math.floor((ate - inicio) / dur);
  for (let k = kIni; k <= kFim; k++) {
    const base = inicio + k * dur;
    for (const ev of eventos) {
      const q = base + ev.t;
      if (q >= de && q < ate && ev._ciclo !== k) saida.push({ quando: q, ev });
    }
  }
  return saida.sort((a, b) => a.quando - b.quando);
}

// Batidas do metrônomo em [de, ate): { quando, forte } — forte no 1 do compasso.
export function batidasNaJanela(base, bpm, de, ate) {
  const b = batida(bpm);
  const saida = [];
  if (!(ate > de)) return saida;
  for (let n = Math.ceil((de - base) / b - EPS); ; n++) {
    const q = base + n * b;
    if (q >= ate) break;
    if (q >= de - EPS) saida.push({ quando: q, forte: ((n % 4) + 4) % 4 === 0 });
  }
  return saida;
}

// Troca o andamento de um beat já gravado: os toques se aproximam ou se
// afastam na mesma proporção, sem mudar a altura dos sons.
export function reescalar(take, novoBpm) {
  const f = take.bpm / novoBpm;
  return {
    ...take,
    bpm: novoBpm,
    dur: take.dur * f,
    eventos: take.eventos.map((e) => ({ ...e, t: e.t * f })),
  };
}

export const ultimaCamada = (eventos) => eventos.reduce((m, e) => Math.max(m, e.camada || 0), 0);

export function desfazerCamada(eventos) {
  if (!eventos.length) return eventos;
  const ult = ultimaCamada(eventos);
  return eventos.filter((e) => (e.camada || 0) !== ult);
}

// Para guardar: tira o que só vale enquanto toca.
export const limparEventos = (eventos) =>
  eventos.map(({ t, pacote, pad, camada }) => ({ t, pacote, pad, camada: camada || 0 }));

export function descreverDuracao(dur, bpm) {
  const c = dur / compasso(bpm);
  const redondo = Math.round(c);
  const s = `${dur.toFixed(1).replace('.', ',')} s`;
  if (Math.abs(c - redondo) < 0.01 && redondo >= 1) return `${redondo} ${redondo === 1 ? 'compasso' : 'compassos'} · ${s}`;
  return s;
}
