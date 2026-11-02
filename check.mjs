// Checagem das funções de data. Rodar: node check.mjs
import assert from 'node:assert/strict';
import { chaveDia, diasDoMes, somaMacros, dataLonga, MESES } from './datas.js';
import { somaBlocos, repsDaSerie, novaSerie, cargaDeTopo, backoff, modosDaFicha } from './treino.js';

assert.equal(chaveDia(new Date(2026, 10, 1)), '2026-11-01');
assert.equal(chaveDia(new Date(2026, 0, 9)), '2026-01-09');

// 1º de janeiro de 2026 é quinta-feira: 4 vazios antes dele numa semana que começa no domingo.
assert.deepEqual(diasDoMes(2026, 0), { vazios: 4, total: 31 });
assert.equal(diasDoMes(2026, 1).total, 28);
assert.equal(diasDoMes(2028, 1).total, 29, 'fevereiro de ano bissexto tem 29 dias');
assert.equal(diasDoMes(2026, 3).total, 30);

// Todo mês cabe na grade de 6 semanas (42 quadrados).
for (let ano = 2024; ano <= 2030; ano++) {
  for (let m = 0; m < 12; m++) {
    const { vazios, total } = diasDoMes(ano, m);
    assert.ok(vazios + total <= 42, `${MESES[m]}/${ano} estourou a grade`);
  }
}

assert.deepEqual(
  somaMacros([{ kcal: 100, p: 10, c: 5, g: 2 }, { kcal: 50, p: 3 }]),
  { kcal: 150, p: 13, c: 5, g: 2 },
  'campo ausente conta como zero'
);
assert.deepEqual(somaMacros([]), { kcal: 0, p: 0, c: 0, g: 0 });

assert.equal(dataLonga('2026-11-01', 2026), '1 de novembro');
assert.equal(dataLonga('2026-01-09', 2026), '9 de janeiro');
assert.equal(dataLonga('2025-12-31', 2026), '31 de dezembro de 2025', 'ano diferente vai junto');

// ---- séries ----

assert.equal(somaBlocos([5, 3, 2]), 10);
assert.equal(somaBlocos([5, null, 2]), 7, 'bloco em branco não conta');
assert.equal(somaBlocos([]), null, 'nada digitado não é zero: é nada');
assert.equal(somaBlocos([null, null]), null);

assert.equal(repsDaSerie({ modo: 'linear', reps: 8 }), 8);
assert.equal(repsDaSerie({ modo: 'cluster', blocos: [5, 3, 2] }), 10);
assert.equal(repsDaSerie({ modo: 'linear' }), null);

// A série nova copia a anterior, menos o RIR e o visto.
assert.deepEqual(
  novaSerie({ modo: 'linear', kg: 80, reps: 8, rir: 1, feita: true }),
  { modo: 'linear', kg: 80, reps: 8, blocos: null, rir: null, feita: false }
);
assert.deepEqual(
  novaSerie({ modo: 'cluster', kg: 70, blocos: [5, 3], rir: 0, feita: true }),
  { modo: 'cluster', kg: 70, reps: null, blocos: [5, 3], rir: null, feita: false }
);
assert.deepEqual(novaSerie(null), { modo: 'linear', kg: null, reps: null, blocos: null, rir: null, feita: false });
assert.equal(novaSerie({ modo: 'cluster' }).blocos.length, 1, 'cluster sem histórico começa com um bloco');
assert.notEqual(novaSerie({ modo: 'cluster', blocos: [5] }).blocos, undefined);

const base = { modo: 'cluster', kg: 70, blocos: [5, 3] };
novaSerie(base).blocos[0] = 99;
assert.deepEqual(base.blocos, [5, 3], 'a série nova não mexe na anterior');

assert.equal(cargaDeTopo([{ kg: 60 }, { kg: 80 }, { kg: null }]), 80);
assert.equal(cargaDeTopo([{ kg: null }]), null);
assert.equal(cargaDeTopo([]), null);

assert.equal(backoff(80, 0.9), 72);
assert.equal(backoff(75, 0.8), 60);
assert.equal(backoff(37.5, 0.9), 33.8, 'arredonda em 0,1 kg');

assert.deepEqual(modosDaFicha({ modos: ['linear', 'cluster'] }), ['linear', 'cluster']);
assert.deepEqual(modosDaFicha({ series: 2, modo: 'cluster' }), ['cluster', 'cluster'], 'ficha antiga: tipo no exercício');
assert.deepEqual(modosDaFicha({}), ['linear', 'linear', 'linear']);

console.log('ok: todas as checagens passaram');
