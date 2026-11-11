// Grava o som que sai do app (depois dos efeitos e do limitador). Usa um
// AudioWorklet; em navegador antigo, cai no ScriptProcessor.

const modulos = new WeakMap();

function juntar(partes, total) {
  return partes.map((lista) => {
    const out = new Float32Array(total);
    let o = 0;
    for (const p of lista) { out.set(p.subarray(0, Math.min(p.length, total - o)), o); o += p.length; if (o >= total) break; }
    return out;
  });
}

export async function gravarSaida(ctx, fonte) {
  const partes = [[], []];
  let frames = 0;
  const receber = (l, r) => { partes[0].push(l); partes[1].push(r); frames += l.length; };
  const mudo = ctx.createGain();
  mudo.gain.value = 0;
  mudo.connect(ctx.destination);
  let no;
  let encerrar;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    if (!modulos.has(ctx)) modulos.set(ctx, ctx.audioWorklet.addModule('gravador-worklet.js'));
    try { await modulos.get(ctx); } catch (e) { modulos.delete(ctx); mudo.disconnect(); throw e; }
    no = new AudioWorkletNode(ctx, 'gravador', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    });
    let avisar;
    const fim = new Promise((ok) => { avisar = ok; });
    no.port.onmessage = (e) => { if (e.data.fim) avisar(); else receber(e.data.l, e.data.r); };
    encerrar = () => {
      no.port.postMessage('fim');
      // Se o áudio estiver pausado a resposta pode não vir: não trava por isso.
      return Promise.race([fim, new Promise((ok) => setTimeout(ok, 800))]);
    };
  } else {
    no = ctx.createScriptProcessor(4096, 2, 2);
    no.onaudioprocess = (e) => {
      const ib = e.inputBuffer;
      receber(ib.getChannelData(0).slice(), ib.getChannelData(ib.numberOfChannels > 1 ? 1 : 0).slice());
    };
    encerrar = async () => {};
  }
  fonte.connect(no);
  no.connect(mudo);
  let parado = false;
  return {
    segundos: () => frames / ctx.sampleRate,
    async parar() {
      if (parado) return null;
      parado = true;
      await encerrar();
      try { fonte.disconnect(no); } catch {}
      try { no.disconnect(); mudo.disconnect(); } catch {}
      if (no.port) no.port.onmessage = null;
      else no.onaudioprocess = null;
      return { canais: juntar(partes, frames), taxa: ctx.sampleRate };
    },
  };
}
