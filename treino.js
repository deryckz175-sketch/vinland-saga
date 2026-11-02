// Lógica pura do treino: a forma de uma série e as contas de carga.
// Fica fora do app.js para ser checada por check.mjs, sem navegador.

/** Soma as reps dos blocos de uma série cluster. null quando nada foi digitado. */
export function somaBlocos(blocos) {
  const feitos = (blocos || []).filter((b) => b != null && b !== '');
  if (!feitos.length) return null;
  return feitos.reduce((t, b) => t + Number(b), 0);
}

/** Reps de uma série, seja linear (digitadas) ou cluster (a soma dos blocos). */
export function repsDaSerie(s) {
  return s.modo === 'cluster' ? somaBlocos(s.blocos) : (s.reps ?? null);
}

/**
 * Série nova moldada numa anterior: herda o tipo, a carga e as reps da última vez.
 * O RIR não é herdado — é como foi hoje, não como foi antes.
 */
export function novaSerie(base) {
  const modo = base?.modo === 'cluster' ? 'cluster' : 'linear';
  return {
    modo,
    kg: base?.kg ?? null,
    reps: modo === 'cluster' ? null : (base?.reps ?? null),
    blocos: modo === 'cluster' ? (base?.blocos?.length ? [...base.blocos] : [null]) : null,
    rir: null,
    feita: false,
  };
}

/** Maior carga digitada no exercício: é dela que saem os backoffs. */
export function cargaDeTopo(series) {
  const kgs = (series || []).map((s) => s.kg).filter((k) => k != null);
  return kgs.length ? Math.max(...kgs) : null;
}

/** Backoff: uma fração da carga de topo, arredondada em 0,1 kg. */
export function backoff(kg, fracao) {
  return Math.round(kg * fracao * 10) / 10;
}

/** Tipos das séries de um exercício da ficha. Ficha antiga guardava o tipo no exercício. */
export function modosDaFicha(e) {
  return e.modos || Array.from({ length: e.series || 3 }, () => e.modo || 'linear');
}
