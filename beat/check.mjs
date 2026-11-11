// Checagem das partes sem navegador do Batuque. Rodar: node beat/check.mjs
import assert from 'node:assert/strict';
import {
  passo, compasso, posicionar, fecharTake, eventosNaJanela, batidasNaJanela,
  reescalar, desfazerCamada, ultimaCamada, limparEventos, limitarBpm, descreverDuracao,
} from './tempo.js';
import { PACOTES, somDoPad, nomeAcorde, notasDoAcorde, ESCALAS, grau } from './sons.js';
import { VOZES } from './synth.js';
import { codificarWav, aparar } from './wav.js';
import { limitar } from './motor.js';

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// --- Tempo
perto(compasso(120), 2, 'compasso a 120');
perto(passo(120), 0.125, 'semicolcheia a 120');
assert.equal(limitarBpm(10), 60);
assert.equal(limitarBpm(999), 200);
assert.equal(limitarBpm('abc'), 120);

// Toque fora da grade vai para a semicolcheia mais perto.
let p = posicionar(0.13, 2, 120, true);
perto(p.t, 0.125, 'ajuste'); assert.equal(p.ciclo, 0);
p = posicionar(0.13, 2, 120, false);
perto(p.t, 0.13, 'sem ajuste');
// Toque logo antes do fim do loop cai no começo da volta seguinte.
p = posicionar(1.99, 2, 120, true);
assert.equal(p.t, 0); assert.equal(p.ciclo, 1);
// Toque na 3ª volta.
p = posicionar(4.5, 2, 120, true);
perto(p.t, 0.5, '3ª volta'); assert.equal(p.ciclo, 2);
// Erro de ponto flutuante não pode gerar t = dur.
for (const bpm of [60, 77, 90, 123, 140, 199]) {
  for (let i = 0; i < 500; i++) {
    const r = Math.random() * 30;
    const dur = compasso(bpm) * (1 + Math.floor(Math.random() * 4));
    const q = posicionar(r, dur, bpm, true);
    assert.ok(q.t >= 0 && q.t < dur, `t fora do loop: ${q.t} / ${dur}`);
  }
}

// Fechar o primeiro take: arredonda para compassos inteiros.
let tk = fecharTake([{ t: 0, pacote: 'trap', pad: 0 }, { t: 0.49, pacote: 'trap', pad: 4 }], 3.7, 120, true);
perto(tk.dur, 4, '1,85 compasso vira 2');
perto(tk.eventos[1].t, 0.5, 'toque ajustado');
tk = fecharTake([{ t: 0, pacote: 'trap', pad: 0 }], 0.4, 120, true);
perto(tk.dur, 2, 'mínimo 1 compasso');
tk = fecharTake([{ t: 0, pacote: 'trap', pad: 0 }, { t: 2.2, pacote: 'trap', pad: 1 }], 2.6, 120, true);
perto(tk.dur, 2, '1,3 compasso vira 1');
perto(tk.eventos.find((e) => e.pad === 1).t, 0.25, 'toque depois do fim dá a volta');
assert.equal(tk.eventos.find((e) => e.pad === 1)._ciclo, 1);
tk = fecharTake([{ t: 0, pacote: 'trap', pad: 0 }], 1.234, 120, false);
perto(tk.dur, 1.234, 'sem ajuste o tamanho é o tocado');

// Janela do agendador.
const evs = [{ t: 0, pad: 0 }, { t: 0.5, pad: 1 }, { t: 1.5, pad: 2 }];
let j = eventosNaJanela(evs, 10, 2, 10, 10.6);
assert.deepEqual(j.map((x) => x.ev.pad), [0, 1]);
j = eventosNaJanela(evs, 10, 2, 11.9, 12.1); // emenda do loop
assert.deepEqual(j.map((x) => x.ev.pad), [0]);
perto(j[0].quando, 12, 'volta 1 começa em 12');
j = eventosNaJanela(evs, 10, 2, 9.5, 10.1); // antes do início (contagem)
assert.deepEqual(j.map((x) => x.ev.pad), [0]);
// Toque gravado ao vivo na volta 1 não toca de novo na volta 1, só na 2.
const ao = [{ t: 0.5, pad: 9, _ciclo: 1 }];
assert.equal(eventosNaJanela(ao, 0, 2, 2, 3).length, 0);
assert.equal(eventosNaJanela(ao, 0, 2, 4, 5).length, 1);
// Janelas seguidas não repetem nem perdem nada.
{
  const lista = Array.from({ length: 16 }, (_, i) => ({ t: i * 0.125, pad: i }));
  const tocados = [];
  for (let i = 0; i < 400; i++) tocados.push(...eventosNaJanela(lista, 0, 2, i / 40, (i + 1) / 40));
  assert.equal(tocados.length, 16 * 5, 'cada toque uma vez por volta');
  const t = tocados.map((x) => x.quando);
  assert.equal(new Set(t.map((x) => x.toFixed(6))).size, t.length, 'sem repetição');
}

// Metrônomo.
let b = batidasNaJanela(0, 120, 0, 2.01);
assert.deepEqual(b.map((x) => x.forte), [true, false, false, false, true]);
b = batidasNaJanela(4, 120, 2, 4); // contagem antes do início
assert.equal(b.length, 4); assert.equal(b[0].forte, true);
{
  let n = 0;
  for (let i = 0; i < 320; i++) n += batidasNaJanela(0, 120, i / 40, (i + 1) / 40).length;
  assert.equal(n, 16, 'cada batida uma vez');
}

// Mudar BPM.
const rs = reescalar({ bpm: 120, dur: 2, eventos: [{ t: 1, pad: 0 }] }, 60);
perto(rs.dur, 4, 'dur dobra'); perto(rs.eventos[0].t, 2, 'toque dobra');

// Camadas.
const cam = [{ t: 0, camada: 0 }, { t: 1, camada: 1 }, { t: 1.5, camada: 2 }, { t: 0.2, camada: 2 }];
assert.equal(ultimaCamada(cam), 2);
assert.deepEqual(desfazerCamada(cam).map((e) => e.camada), [0, 1]);
assert.deepEqual(limparEventos([{ t: 1, pacote: 'trap', pad: 3, _ciclo: 2 }]), [{ t: 1, pacote: 'trap', pad: 3, camada: 0 }]);
assert.equal(descreverDuracao(4, 120), '2 compassos · 4,0 s');
assert.equal(descreverDuracao(1.3, 120), '1,3 s');

// --- Sons
assert.equal(PACOTES.length, 6);
assert.equal(new Set(PACOTES.map((p) => p.id)).size, 6);
for (const pac of PACOTES) {
  for (let pad = 0; pad < 32; pad++) {
    const s = somDoPad(pac.id, pad);
    assert.ok(s && s.nome, `${pac.id}:${pad} sem nome`);
    assert.ok(VOZES[s.tipo], `${pac.id}:${pad} tipo desconhecido ${s.tipo}`);
    if (s.tipo === 'acorde') assert.ok(VOZES[s.p.instr], `${pac.id}:${pad} instrumento ${s.p.instr}`);
    if (s.grupo) assert.ok(s.grupo.startsWith(`${pac.id}:`), 'grupo é por pacote');
  }
}
assert.equal(nomeAcorde([60, 64, 67]), 'C');
assert.equal(nomeAcorde([57, 60, 64]), 'Am');
assert.equal(nomeAcorde([59, 62, 65]), 'B°');
assert.equal(nomeAcorde([60, 64, 67, 71]), 'Cmaj7');
assert.equal(nomeAcorde([62, 65, 69, 72]), 'Dm7');
assert.equal(nomeAcorde([67, 71, 74, 77]), 'G7');
assert.equal(nomeAcorde([71, 74, 77, 81]), 'Bm7♭5');
// Campo harmônico de C maior.
assert.deepEqual(
  Array.from({ length: 7 }, (_, i) => nomeAcorde(notasDoAcorde(ESCALAS.maior, 60, i, false))),
  ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°'],
);
assert.equal(grau(ESCALAS.maior, 60, 7), 72, 'oitavo grau é a oitava');
assert.equal(somDoPad('lofi', 16).nome, 'D#maj7');
assert.equal(somDoPad('trap', 24).nome, 'C# 808');

// --- WAV
const wav = codificarWav([new Float32Array([0, 1, -1, 2]), new Float32Array([0, 0.5, -0.5, NaN])], 44100);
const v = new DataView(wav);
assert.equal(wav.byteLength, 44 + 4 * 2 * 2);
assert.equal(String.fromCharCode(...new Uint8Array(wav, 0, 4)), 'RIFF');
assert.equal(v.getUint16(22, true), 2);
assert.equal(v.getUint32(24, true), 44100);
assert.equal(v.getInt16(44 + 4, true), 32767, '1 → máximo');
assert.equal(v.getInt16(44 + 8, true), -32768, '-1 → mínimo');
assert.equal(v.getInt16(44 + 12, true), 32767, 'acima de 1 é cortado');
assert.equal(v.getInt16(44 + 14, true), 0, 'NaN vira 0');

// Aparar: tira silêncio, normaliza.
{
  const sr = 1000;
  const x = new Float32Array(3000);
  for (let i = 1000; i < 1500; i++) x[i] = Math.sin(i) * 0.3;
  const [y] = aparar([x], sr);
  assert.ok(y.length < 600 && y.length > 490, `tamanho ${y.length}`);
  const pico = y.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  assert.ok(pico > 0.85 && pico <= 0.9 + 1e-6, `pico ${pico}`);
  assert.equal(aparar([new Float32Array(100)], sr), null, 'silêncio');
  const longo = new Float32Array(sr * 30).fill(0.5);
  assert.equal(aparar([longo], sr, { maxSeg: 10 })[0].length, sr * 10, 'corta em 10 s');
}

// --- Limitador: transparente até 0,6, nunca passa de 1, sempre crescente.
assert.equal(limitar(0.5), 0.5);
assert.equal(limitar(-0.3), -0.3);
assert.ok(limitar(4) < 1 && limitar(4) > 0.99);
assert.equal(limitar(-2), -limitar(2));
for (let u = 0; u < 4; u += 0.01) assert.ok(limitar(u + 0.01) >= limitar(u));

console.log('ok — beat/check.mjs');
