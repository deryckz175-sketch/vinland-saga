// Roda na thread de áudio: copia o que chega na entrada e manda em blocos para
// a página. Se a entrada vier vazia (nada tocando), conta como silêncio — senão
// as pausas sumiriam da gravação.
class Gravador extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tam = 8192;
    this.novo();
    this.port.onmessage = () => {
      this.enviar();
      this.port.postMessage({ fim: true });
    };
  }

  novo() {
    this.l = new Float32Array(this.tam);
    this.r = new Float32Array(this.tam);
    this.n = 0;
  }

  enviar() {
    if (!this.n) return;
    const l = this.l.slice(0, this.n);
    const r = this.r.slice(0, this.n);
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.novo();
  }

  guardar(a, b, len) {
    let i = 0;
    while (i < len) {
      const k = Math.min(len - i, this.tam - this.n);
      if (a) { this.l.set(a.subarray(i, i + k), this.n); this.r.set(b.subarray(i, i + k), this.n); }
      this.n += k; // sem entrada: os zeros do Float32Array novo ficam
      i += k;
      if (this.n === this.tam) this.enviar();
    }
  }

  process(inputs) {
    const ent = inputs[0];
    if (ent && ent.length) this.guardar(ent[0], ent[1] || ent[0], ent[0].length);
    else this.guardar(null, null, 128);
    return true;
  }
}
registerProcessor('gravador', Gravador);
