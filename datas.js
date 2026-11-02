// Funções puras de data e soma. Sem DOM, para poderem ser testadas por check.mjs.

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function chaveDia(data) {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}

// A semana começa no domingo, então getDay() (0 = domingo) já é o número de vazios.
export function diasDoMes(ano, mes) {
  return {
    vazios: new Date(ano, mes, 1).getDay(),
    total: new Date(ano, mes + 1, 0).getDate(),
  };
}

/** '2026-11-01' → '1 de novembro'. Leva o ano junto quando não é o de referência. */
export function dataLonga(chave, anoRef) {
  const [a, m, d] = chave.split('-');
  const base = `${+d} de ${MESES[+m - 1].toLowerCase()}`;
  return +a === anoRef ? base : `${base} de ${a}`;
}

/** A chave n dias depois de outra. Conta pelo calendário, então vira mês e ano certo. */
export function somaDias(chave, n) {
  const [a, m, d] = chave.split('-').map(Number);
  return chaveDia(new Date(a, m - 1, d + n));
}

export function somaMacros(itens) {
  return itens.reduce((t, i) => ({
    kcal: t.kcal + (i.kcal || 0),
    p: t.p + (i.p || 0),
    c: t.c + (i.c || 0),
    g: t.g + (i.g || 0),
  }), { kcal: 0, p: 0, c: 0, g: 0 });
}
