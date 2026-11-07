// Lógica pura da dieta: o que conta no dia e como uma quantidade muda.
// Fica fora do app.js para ser checada por check.mjs, sem navegador.

/**
 * O que ele comeu de fato: refeição do plano só conta depois de concluída.
 * Sem o campo `feita` são os dias gravados antes de existir o concluir, e
 * aqueles itens ele registrou à mão, então contam.
 */
export function itensComidos(refeicoes) {
  return (refeicoes || []).filter((r) => r.feita !== false).flatMap((r) => r.itens || []);
}

/** O dia começa com as refeições do plano, por marcar. Uma opção substitui, não soma. */
export function refeicoesDoPlano(plano) {
  return plano.refeicoes.filter((r) => !r.opcaoDe).map((r) => ({
    nome: r.nome,
    itens: r.itens.map((i) => ({ ...i })),
    feita: false,
  }));
}

/**
 * Dá ao dia a dieta dele, por marcar. O que já tinha sido registrado à mão fica
 * junto, e as refeições vazias saem. A marca impede remontar o dia: ele pode ter
 * alterado ou tirado alguma coisa.
 */
export function montarDia(dia, plano) {
  if (!plano || dia.doPlano) return dia;
  dia.refeicoes = [...refeicoesDoPlano(plano), ...dia.refeicoes.filter((r) => r.itens.length)];
  dia.doPlano = true;
  return dia;
}

/** O mesmo alimento em outra quantidade: os macros acompanham na mesma proporção. */
export function comQuantidade(item, g) {
  const f = g / item.g_;
  return { ...item, g_: g, kcal: item.kcal * f, p: item.p * f, c: item.c * f, g: item.g * f };
}

const MACROS = ['kcal', 'p', 'c', 'g'];
const PUXAO = 0.01;

/**
 * Refaz as quantidades do que ele não mexeu para a refeição voltar a bater o alvo.
 * São mínimos quadrados nos quatro números, em erro relativo (um grama de gordura
 * pesa tanto quanto as calorias), resolvidos um alimento por vez. Cada alimento fica
 * entre metade e o dobro da quantidade do plano (`g0`), com um puxão leve para perto
 * dela: sem isso, para compensar proteína que não tem como compensar, a conta tirava
 * o feijão inteiro. Guardar `g0` também impede que mexidas seguidas escorreguem.
 */
export function adaptarRefeicao(itens, alvo) {
  // shortcut: o que é "unidade" (o ovo) não vira meio ovo, e é o nome no plano que avisa. Virar campo no JSON se aparecer outro.
  const soltos = itens.map((it, i) => (!it.fixo && it.g_ > 0 && !/unidade/i.test(it.nome) ? i : -1)).filter((i) => i >= 0);
  if (!soltos.length) return itens;
  const peso = MACROS.map((k) => 1 / Math.max(alvo[k], 1) ** 2);
  const porGrama = soltos.map((i) => MACROS.map((k) => (itens[i][k] || 0) / itens[i].g_));
  const base = soltos.map((i) => itens[i].g0 ?? itens[i].g_);
  const q = soltos.map((i) => itens[i].g_);
  const desvio = MACROS.map((k) => itens.reduce((t, it) => t + (it[k] || 0), 0) - alvo[k]);
  for (let volta = 0; volta < 400; volta++) {
    for (let j = 0; j < soltos.length; j++) {
      let inclinacao = (PUXAO * (q[j] - base[j])) / base[j] ** 2;
      let curva = PUXAO / base[j] ** 2;
      for (let k = 0; k < MACROS.length; k++) {
        inclinacao += peso[k] * porGrama[j][k] * desvio[k];
        curva += peso[k] * porGrama[j][k] ** 2;
      }
      const novo = Math.min(base[j] * 2, Math.max(base[j] / 2, q[j] - inclinacao / curva));
      for (let k = 0; k < MACROS.length; k++) desvio[k] += porGrama[j][k] * (novo - q[j]);
      q[j] = novo;
    }
  }
  const saida = [...itens];
  soltos.forEach((i, j) => { saida[i] = { ...comQuantidade(itens[i], Math.round(q[j])), g0: base[j] }; });
  return saida;
}
