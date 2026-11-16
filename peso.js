// Lógica pura do peso corporal: recorte por período e a geometria do gráfico.
// Fica fora do app.js para ser checada por check.mjs, sem navegador.

import { somaDias } from './datas.js';

export const PERIODOS = [
  { id: '1m', nome: '1M', dias: 30 },
  { id: '3m', nome: '3M', dias: 91 },
  { id: '1a', nome: '1A', dias: 365 },
  { id: 'tudo', nome: 'Tudo', dias: null },
];

/** Do mais velho para o mais novo. Um registro por dia: a chave é a data. */
export const ordenarPesos = (lista) => [...(lista || [])].sort((a, b) => a.data.localeCompare(b.data));

/** Os registros dentro do período, contando para trás a partir de hoje. */
export function recortePeso(pesos, periodo, hoje) {
  const p = PERIODOS.find((x) => x.id === periodo);
  if (!p?.dias) return pesos;
  const inicio = somaDias(hoje, -p.dias);
  return pesos.filter((x) => x.data >= inicio);
}

/** Último menos o primeiro do recorte. null com menos de dois registros. */
export function variacaoPeso(pesos) {
  if (pesos.length < 2) return null;
  return Math.round((pesos[pesos.length - 1].kg - pesos[0].kg) * 10) / 10;
}

const diaNum = (chave) => {
  const [a, m, d] = chave.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
};

/**
 * Onde cada ponto cai no desenho. O x é pelo calendário, não pela ordem: duas
 * pesagens com um mês no meio ficam longe uma da outra. O y vai de um número
 * redondo a outro e cobre pelo menos 2 kg, para meio quilo não parecer um abismo.
 */
export function geometriaPeso(pesos, { largura, altura, esq = 34, dir = 10, topo = 10, base = 22 }) {
  if (!pesos.length) return null;
  const kgs = pesos.map((p) => p.kg);
  let min = Math.min(...kgs);
  let max = Math.max(...kgs);
  const falta = Math.max(0, 2 - (max - min));
  min -= falta / 2; max += falta / 2;
  // O menor passo redondo que deixa no máximo seis linhas, todas com o mesmo espaço.
  const passo = [1, 2, 5, 10, 20, 50].find((x) => Math.ceil(max / x) - Math.floor(min / x) <= 5) ?? 100;
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;

  const d0 = diaNum(pesos[0].data);
  const d1 = diaNum(pesos[pesos.length - 1].data);
  const larguraUtil = largura - esq - dir;
  const alturaUtil = altura - topo - base;
  const x = (data) => (d1 === d0 ? esq + larguraUtil / 2 : esq + ((diaNum(data) - d0) / (d1 - d0)) * larguraUtil);
  const y = (kg) => topo + ((max - kg) / (max - min)) * alturaUtil;

  const pontos = pesos.map((p) => ({ ...p, x: x(p.data), y: y(p.kg) }));
  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const marcas = [];
  for (let v = min; v <= max + 1e-9; v += passo) marcas.push({ kg: Math.round(v * 10) / 10, y: y(v) });
  return { pontos, linha, marcas, esq, dir, topo, base };
}

/** O ponto mais perto de um x do desenho: é ele que o dedo está apontando. */
export function pontoMaisPerto(pontos, x) {
  let melhor = null;
  for (const p of pontos) if (!melhor || Math.abs(p.x - x) < Math.abs(melhor.x - x)) melhor = p;
  return melhor;
}
