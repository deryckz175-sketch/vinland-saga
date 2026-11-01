// Checagem das funções de data. Rodar: node check.mjs
import assert from 'node:assert/strict';
import { chaveDia, diasDoMes, somaMacros, MESES } from './datas.js';

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

console.log('ok: todas as checagens passaram');
