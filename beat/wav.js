// WAV 16 bits e limpeza de amostras. Funções puras sobre Float32Array.

export function codificarWav(canais, taxa) {
  const nc = canais.length;
  const n = canais[0].length;
  const bytes = n * nc * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      let s = canais[c][i];
      if (!(s === s)) s = 0; // NaN
      s = Math.max(-1, Math.min(1, s));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

// Corta o silêncio do começo e do fim, limita a duração, normaliza o volume e
// faz uma rampa curtinha no fim para não estalar. Devolve null se for só silêncio.
export function aparar(canais, taxa, { maxSeg = 10, limiar = 0.02 } = {}) {
  const n = canais[0].length;
  let pico = 0;
  for (const ch of canais) for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > pico) pico = a; }
  if (pico < 0.002) return null;
  const corte = pico * limiar;
  const passou = (i) => canais.some((ch) => Math.abs(ch[i]) > corte);
  let ini = 0;
  while (ini < n && !passou(ini)) ini++;
  let fim = n - 1;
  while (fim > ini && !passou(fim)) fim--;
  ini = Math.max(0, ini - Math.round(taxa * 0.004));
  fim = Math.min(n, fim + Math.round(taxa * 0.03), ini + Math.round(maxSeg * taxa));
  const len = Math.max(1, fim - ini);
  const ganho = 0.9 / pico;
  const rampa = Math.min(len, Math.round(taxa * 0.008));
  return canais.map((ch) => {
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = ch[ini + i] * ganho;
    for (let i = 0; i < rampa; i++) out[len - 1 - i] *= i / rampa;
    return out;
  });
}
