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
