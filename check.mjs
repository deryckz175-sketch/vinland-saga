// Checagem das funções de data. Rodar: node check.mjs
import assert from 'node:assert/strict';
import { chaveDia, diasDoMes, somaMacros, dataLonga, MESES } from './datas.js';
import {
  somaBlocos, repsDaSerie, novaSerie, cargaDeTopo, backoff, modosDaFicha,
  temBlocos, trocarTipo, lerNumero, virgula, textoDoTreino,
} from './treino.js';
import { itensComidos, refeicoesDoPlano, comQuantidade } from './dieta.js';
import { readFileSync } from 'node:fs';

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

// ---- números com vírgula ----

assert.equal(lerNumero('12,5'), 12.5);
assert.equal(lerNumero('12.5'), 12.5);
assert.equal(lerNumero('8,'), 8, 'no meio da digitação');
assert.equal(lerNumero(''), null, 'campo vazio não é zero');
assert.equal(lerNumero('  '), null);
assert.equal(lerNumero('abc'), null);
assert.equal(lerNumero('0'), 0, 'zero é zero');
assert.equal(virgula(12.5), '12,5');
assert.equal(virgula(0), '0');
assert.equal(virgula(null), '');

// ---- tipo da série ----

const giro = { modo: 'linear', reps: 8, blocos: null };
trocarTipo(giro);
assert.deepEqual(giro, { modo: 'cluster', reps: null, blocos: [8] }, 'as reps viram o primeiro bloco');
giro.blocos = [5, 2, 2];
trocarTipo(giro);
assert.deepEqual(giro, { modo: 'restpause', reps: null, blocos: [5, 2, 2] }, 'cluster e rest pause têm a mesma forma');
trocarTipo(giro);
assert.deepEqual(giro, { modo: 'linear', reps: 9, blocos: null }, 'a soma volta a ser as reps');

assert.ok(temBlocos('restpause') && temBlocos('cluster') && !temBlocos('linear') && !temBlocos(undefined));
assert.equal(repsDaSerie({ modo: 'restpause', blocos: [3, 1] }), 4);
assert.deepEqual(novaSerie({ modo: 'restpause', kg: 15, blocos: [3, 1], rir: 0 }),
  { modo: 'restpause', kg: 15, reps: null, blocos: [3, 1], rir: null, feita: false });
assert.equal(somaBlocos([8.5, 1]), 9.5, 'meia repetição soma');

// ---- exportar: as seis linhas que ele mandou, ao pé da letra ----

const lin = (kg, reps) => ({ modo: 'linear', kg, reps, blocos: null });
const treinoDele = [
  { nome: 'Remada curvada', series: [lin(65, 4), lin(65, 4), lin(65, 4)] },
  { nome: 'Kelson Shruggs', series: [lin(60, 7), lin(60, 6)] },
  { nome: 'Puxada alta', series: [{ modo: 'cluster', kg: 70, reps: 7, blocos: [2, 2, 2, 1] }, lin(60, 8)] },
  { nome: 'Supino reto', series: [lin(57, 5), lin(50, 8.5)] },
  { nome: 'Mergulho', series: [{ modo: 'restpause', kg: 15, reps: 4, blocos: [3, 1] }, { modo: 'restpause', kg: 10, reps: 9, blocos: [5, 2, 2] }] },
  { nome: 'Rosca no banco', series: [lin(12.5, 5), lin(10, 6)] },
];
assert.equal(textoDoTreino(treinoDele, (nome) => nome === 'Mergulho'), [
  'Remada curvada 65 4/4/4',
  'Kelson Shruggs 60 7/6',
  'Puxada alta 70 4:2-1 / 60 8',
  'Supino reto 57 5 / 50 8,5',
  'Mergulho +15 3+1 / +10 5+2+2',
  'Rosca no banco 12,5 5 / 10 6',
].join('\n'));

const umaSerie = (s) => textoDoTreino([{ nome: 'X', series: [{ kg: 50, ...s }] }]);
assert.equal(umaSerie({ modo: 'cluster', blocos: [2, 2, 2, 2] }), 'X 50 4:2', 'todos iguais');
assert.equal(umaSerie({ modo: 'cluster', blocos: [3, 1] }), 'X 50 2:3-1');
assert.equal(umaSerie({ modo: 'cluster', blocos: [5, 3, 2] }), 'X 50 3:5-3-2', 'fora do desenho lista todos');
assert.equal(umaSerie({ modo: 'cluster', blocos: [2, 2, 1, 1] }), 'X 50 4:2-2-1-1', 'não perde informação');
assert.equal(umaSerie({ modo: 'cluster', blocos: [5] }), 'X 50 5', 'um bloco só é uma série comum');
assert.equal(umaSerie({ modo: 'restpause', blocos: [5] }), 'X 50 5');
assert.equal(umaSerie({ modo: 'cluster', blocos: [2, null, 2] }), 'X 50 2:2', 'bloco em branco não conta');
assert.equal(umaSerie({ modo: 'cluster', blocos: [null] }), '', 'sem reps não há o que escrever');
assert.equal(umaSerie({ modo: 'linear', reps: null }), '');
assert.equal(textoDoTreino([{ nome: 'Barra fixa', series: [lin(null, 8), lin(null, 7)] }], () => true), 'Barra fixa 8/7', 'sem carga, só as reps');
assert.equal(textoDoTreino([{ nome: 'A', series: [lin(50, 8)] }, { nome: 'B', series: [lin(null, null)] }]), 'A 50 8', 'exercício sem nada some');
assert.equal(textoDoTreino([]), '');
assert.equal(textoDoTreino([{ nome: 'X', series: [lin(70, 8), lin(60, 8), lin(70, 6)] }]), 'X 70 8 / 60 8 / 70 6', 'só junta carga seguida');

// ---- dieta ----

const planoReal = JSON.parse(readFileSync(new URL('./dados/plano-alimentar.json', import.meta.url)));
const doDia = refeicoesDoPlano(planoReal);
assert.deepEqual(doDia.map((r) => r.nome), ['Café da manhã', 'Almoço', 'Lanche da tarde', 'Janta', 'Ceia'], 'a opção com macarrão não entra no dia');
assert.ok(doDia.every((r) => r.feita === false), 'o dia começa por marcar');
const totalDoPlano = doDia.flatMap((r) => r.itens).reduce((t, i) => t + i.kcal, 0);
assert.ok(Math.abs(totalDoPlano - planoReal.alvo.kcal) <= 5, `as cinco refeições somam o alvo do plano (${totalDoPlano})`);
doDia[0].itens[0].kcal = 999;
assert.notEqual(planoReal.refeicoes[0].itens[0].kcal, 999, 'mexer no dia não mexe no plano');

const opcao = planoReal.refeicoes.find((r) => r.opcaoDe);
assert.deepEqual(opcao.opcaoDe, ['Almoço', 'Janta']);

const it = { nome: 'Arroz', kcal: 100 };
assert.deepEqual(itensComidos([
  { feita: false, itens: [it] },
  { feita: true, itens: [it, it] },
  { itens: [it] },
]), [it, it, it], 'só não conta o que está por marcar; dia antigo conta');
assert.deepEqual(itensComidos(undefined), []);

assert.deepEqual(comQuantidade({ nome: 'A', g_: 100, kcal: 40, p: 1, c: 2, g: 3 }, 150),
  { nome: 'A', g_: 150, kcal: 60, p: 1.5, c: 3, g: 4.5 });

console.log('ok: todas as checagens passaram');
