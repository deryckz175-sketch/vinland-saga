// Ajuste da foto no círculo. Não recorta nada: guarda só a posição e o zoom, então
// dá para ajustar de novo depois sem escolher a foto outra vez.

export const AJUSTE_PADRAO = { x: 50, y: 50, zoom: 1 };
export const ZOOM_MAXIMO = 5;

const entre = (v, min, max) => Math.min(max, Math.max(min, v));

/** Com o mesmo ponto em object-position e transform-origin, nenhum ajuste deixa buraco no círculo. */
export function estiloFoto(ajuste) {
  const { x, y, zoom } = { ...AJUSTE_PADRAO, ...ajuste };
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${zoom})`;
}

/** A bolinha na foto, em pixels da foto: o que aparece no círculo do perfil com esse ajuste. */
export function circuloDoAjuste(ajuste, largura, altura) {
  const { x, y, zoom } = { ...AJUSTE_PADRAO, ...ajuste };
  const d = Math.min(largura, altura) / zoom;
  return { esq: (x / 100) * (largura - d), topo: (y / 100) * (altura - d), d };
}

/** O caminho de volta: a bolinha vira o ajuste que é guardado. */
export function ajusteDoCirculo({ esq, topo, d }, largura, altura) {
  return {
    x: largura > d ? (esq / (largura - d)) * 100 : 50,
    y: altura > d ? (topo / (altura - d)) * 100 : 50,
    zoom: Math.min(largura, altura) / d,
  };
}

/** Anda com a bolinha sem deixá-la sair da foto. */
export function moverCirculo(c, dx, dy, largura, altura) {
  return { ...c, esq: entre(c.esq + dx, 0, largura - c.d), topo: entre(c.topo + dy, 0, altura - c.d) };
}

/** Muda o tamanho mantendo o centro; perto da borda, a bolinha anda para continuar dentro da foto. */
export function tamanhoCirculo(c, novo, largura, altura) {
  const menor = Math.min(largura, altura);
  const d = entre(novo, menor / ZOOM_MAXIMO, menor);
  return moverCirculo({ esq: c.esq + (c.d - d) / 2, topo: c.topo + (c.d - d) / 2, d }, 0, 0, largura, altura);
}
