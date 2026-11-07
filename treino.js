// Lógica pura do treino: a forma de uma série e as contas de carga.
// Fica fora do app.js para ser checada por check.mjs, sem navegador.

/** Cluster e rest pause têm a mesma forma: uma carga só, com as reps em partes. */
export const temBlocos = (modo) => modo === 'cluster' || modo === 'restpause';

/** O teclado do iPhone em português digita vírgula; o resto do app trabalha com número. */
export function lerNumero(txt) {
  const t = String(txt ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/** O caminho de volta: 12.5 vira "12,5", e nada vira campo vazio. */
export const virgula = (v) => (v == null ? '' : String(v).replace('.', ','));

/** Soma as reps das partes de uma série. null quando nada foi digitado. */
export function somaBlocos(blocos) {
  const feitos = (blocos || []).filter((b) => b != null && b !== '');
  if (!feitos.length) return null;
  return feitos.reduce((t, b) => t + Number(b), 0);
}

/** Reps de uma série: as digitadas na linear, a soma das partes nas outras. */
export function repsDaSerie(s) {
  return temBlocos(s.modo) ? somaBlocos(s.blocos) : (s.reps ?? null);
}

/** Muda o tipo sem perder reps: a soma das partes vira as reps, e as reps viram a primeira parte. */
export function mudarTipo(s, modo) {
  if ((s.modo || 'linear') === modo) return;
  if (modo === 'linear') {
    s.reps = somaBlocos(s.blocos);
    s.blocos = null;
  } else if (!temBlocos(s.modo)) {
    s.blocos = [s.reps ?? null];
    s.reps = null;
  }
  // Rest pause é a série e pelo menos uma volta depois da pausa: já deixa o lugar dela.
  if (modo === 'restpause' && s.blocos.length < 2) s.blocos.push(null);
  s.modo = modo;
}

/** O cluster como ele escreve, 4:2-1: quantos blocos, as reps de cada um e as do último. */
export function partesDoCluster(blocos) {
  const b = blocos?.length ? blocos : [null];
  const ultimo = b[b.length - 1];
  return { n: b.length, r: b[0] ?? null, u: b.length > 1 && ultimo !== b[0] ? ultimo : null };
}

/** O caminho de volta. Último em branco é igual aos outros. */
export function blocosDoCluster({ n, r, u }) {
  const total = Math.min(50, Math.max(1, Math.round(n || 1)));
  if (total === 1) return [r ?? null];
  return [...Array(total - 1).fill(r ?? null), u ?? r ?? null];
}

/**
 * 1RM estimado pela fórmula de Epley: carga × (1 + reps/30). O RIR entra como as
 * reps que ainda dava para fazer: 80 kg × 6 com 2 na reserva conta como 8 até a falha.
 */
export function umRM(kg, reps, rir) {
  if (!(kg > 0) || !(reps > 0)) return null;
  const ateFalha = reps + (rir || 0);
  return ateFalha <= 1 ? kg : kg * (1 + ateFalha / 30);
}

/** A série que dá o maior 1RM. Só a linear conta: bloco de cluster não vai até a falha. */
export function melhorSerie(series) {
  let melhor = null;
  for (const s of series || []) {
    if (temBlocos(s.modo)) continue;
    const rm = umRM(s.kg, s.reps, s.rir);
    if (rm != null && (!melhor || rm > melhor.rm)) melhor = { kg: s.kg, reps: s.reps, rir: s.rir ?? null, rm };
  }
  return melhor;
}

/**
 * Série nova moldada numa anterior: herda o tipo, a carga e as reps da última vez.
 * O RIR não é herdado — é como foi hoje, não como foi antes.
 */
export function novaSerie(base) {
  const modo = temBlocos(base?.modo) ? base.modo : 'linear';
  return {
    modo,
    kg: base?.kg ?? null,
    reps: temBlocos(modo) ? null : (base?.reps ?? null),
    blocos: temBlocos(modo) ? (base?.blocos?.length ? [...base.blocos] : [null]) : null,
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

// ---- exportar em texto ----

/** 4:2-1 são quatro blocos de duas, o último com uma. Fora desse desenho, lista todos. */
function textoCluster(b) {
  const cabeca = b.slice(0, -1);
  const ultimo = b[b.length - 1];
  if (cabeca.some((x) => x !== cabeca[0])) return `${b.length}:${b.map(virgula).join('-')}`;
  return `${b.length}:${virgula(cabeca[0])}${ultimo === cabeca[0] ? '' : `-${virgula(ultimo)}`}`;
}

/** Uma série escrita: 8,5 na linear, 5+2+2 no rest pause, 4:2-1 no cluster. */
function textoDaSerie(s) {
  const b = (s.blocos || []).filter((x) => x != null);
  if (!temBlocos(s.modo) || !b.length) return virgula(s.reps);
  if (b.length === 1) return virgula(b[0]);
  return s.modo === 'cluster' ? textoCluster(b) : b.map(virgula).join('+');
}

/** Séries seguidas com a mesma carga ficam juntas (65 4/4/4); carga nova abre grupo (70 8 / 60 8). */
function linhaDoExercicio(ex, corporal) {
  const grupos = [];
  for (const s of ex.series) {
    const texto = textoDaSerie(s);
    if (!texto) continue;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.kg === s.kg) ultimo.series.push(texto);
    else grupos.push({ kg: s.kg, series: [texto] });
  }
  if (!grupos.length) return '';
  const carga = (kg) => (kg ? `${corporal ? '+' : ''}${virgula(kg)} ` : '');
  return `${ex.nome} ${grupos.map((g) => carga(g.kg) + g.series.join('/')).join(' / ')}`;
}

/** O treino em texto, um exercício por linha. No peso corporal a carga é o que foi somado: +15. */
export function textoDoTreino(exercicios, ehCorporal = () => false) {
  return exercicios.map((ex) => linhaDoExercicio(ex, ehCorporal(ex.nome))).filter(Boolean).join('\n');
}
