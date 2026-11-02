// Ajuste da foto no círculo. Não recorta nada: guarda só a posição e o zoom, então
// dá para ajustar de novo depois sem escolher a foto outra vez.

export const AJUSTE_PADRAO = { x: 50, y: 50, zoom: 1 };

const limita = (v) => Math.min(100, Math.max(0, v));

/** Com o mesmo ponto em object-position e transform-origin, nenhum ajuste deixa buraco no círculo. */
export function estiloFoto(ajuste) {
  const { x, y, zoom } = { ...AJUSTE_PADRAO, ...ajuste };
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${zoom})`;
}

/**
 * Faz a foto acompanhar o dedo. `lado` é o diâmetro do círculo em pixels, e
 * `largura`/`altura` são as da foto. A folga é o quanto a foto sobra para fora do
 * círculo em cada eixo: sem folga, aquele eixo não tem para onde andar.
 */
export function moverFoto(ajuste, dx, dy, lado, largura, altura) {
  const folgaX = lado * ajuste.zoom * Math.max(1, largura / altura) - lado;
  const folgaY = lado * ajuste.zoom * Math.max(1, altura / largura) - lado;
  return {
    ...ajuste,
    x: folgaX > 0 ? limita(ajuste.x - (dx / folgaX) * 100) : ajuste.x,
    y: folgaY > 0 ? limita(ajuste.y - (dy / folgaY) * 100) : ajuste.y,
  };
}
