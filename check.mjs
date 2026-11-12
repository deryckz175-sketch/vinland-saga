// Checagem das funções de data. Rodar: node check.mjs
import assert from 'node:assert/strict';
import { chaveDia, diasDoMes, somaMacros, dataLonga, somaDias, MESES } from './datas.js';
import {
  somaBlocos, repsDaSerie, novaSerie, cargaDeTopo, backoff, modosDaFicha,
  temBlocos, mudarTipo, lerNumero, virgula, textoDoTreino,
  partesDoCluster, blocosDoCluster, umRM, melhorSerie, serieAnterior,
} from './treino.js';
import { itensComidos, refeicoesDoPlano, comQuantidade, montarDia, adaptarRefeicao, adaptarDia } from './dieta.js';
import { ZOOM_MAXIMO, estiloFoto, circuloDoAjuste, ajusteDoCirculo, moverCirculo, tamanhoCirculo } from './foto.js';
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

// Cada série puxa a carga da mesma série da última vez, não todas a da primeira.
const ultimaVez = [{ kg: 100, reps: 5 }, { kg: 90, reps: 8 }, { kg: 80, reps: 10 }];
assert.deepEqual([0, 1, 2].map((i) => novaSerie(serieAnterior(ultimaVez, i)).kg), [100, 90, 80]);
assert.equal(serieAnterior(ultimaVez, 5).kg, 80, 'série a mais repete a última');
assert.equal(serieAnterior(undefined, 0), null);
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
mudarTipo(giro, 'cluster');
assert.deepEqual(giro, { modo: 'cluster', reps: null, blocos: [8] }, 'as reps viram o primeiro bloco');
giro.blocos = [5, 2, 2];
mudarTipo(giro, 'restpause');
assert.deepEqual(giro, { modo: 'restpause', reps: null, blocos: [5, 2, 2] }, 'cluster e rest pause têm a mesma forma');
mudarTipo(giro, 'linear');
assert.deepEqual(giro, { modo: 'linear', reps: 9, blocos: null }, 'a soma volta a ser as reps');
const paraRp = { modo: 'linear', reps: 8, blocos: null };
mudarTipo(paraRp, 'restpause');
assert.deepEqual(paraRp.blocos, [8, null], 'rest pause já abre o lugar das reps depois da pausa');
const semTipo = { reps: 6 };
mudarTipo(semTipo, 'linear');
assert.equal(semTipo.reps, 6, 'série gravada antes de existir o tipo já é linear: nada muda');

// ---- cluster como ele escreve: 4:2-1 ----

assert.deepEqual(partesDoCluster([2, 2, 2, 1]), { n: 4, r: 2, u: 1 });
assert.deepEqual(partesDoCluster([2, 2, 2]), { n: 3, r: 2, u: null }, 'último igual aos outros fica em branco');
assert.deepEqual(partesDoCluster([8]), { n: 1, r: 8, u: null });
assert.deepEqual(partesDoCluster(null), { n: 1, r: null, u: null });
assert.deepEqual(blocosDoCluster({ n: 4, r: 2, u: 1 }), [2, 2, 2, 1]);
assert.deepEqual(blocosDoCluster({ n: 3, r: 2, u: null }), [2, 2, 2], 'último em branco é igual aos outros');
assert.deepEqual(blocosDoCluster({ n: null, r: 5, u: 1 }), [5], 'apagar o número de blocos para redigitar não quebra');
assert.equal(blocosDoCluster({ n: 999, r: 1, u: null }).length, 50, 'erro de digitação não cria mil blocos');
for (const b of [[2, 2, 2, 1], [3, 3], [8], [1, 1, 1, 1, 1]]) {
  assert.deepEqual(blocosDoCluster(partesDoCluster(b)), b, `ida e volta de ${b}`);
}
assert.equal(textoDoTreino([{ nome: 'Puxada', series: [{ modo: 'cluster', kg: 70, blocos: blocosDoCluster({ n: 4, r: 2, u: 1 }) }] }]),
  'Puxada 70 4:2-1', 'o que ele digita nos três campos sai igual no texto');

// ---- 1RM ----

assert.equal(umRM(100, 1), 100, 'uma rep é o próprio 1RM');
assert.equal(umRM(100, 10), 100 * (1 + 10 / 30));
assert.equal(umRM(80, 6, 2), umRM(80, 8), 'RIR conta como as reps que faltaram');
assert.equal(umRM(null, 5), null);
assert.equal(umRM(80, null), null);
assert.equal(umRM(80, 0), null);
assert.deepEqual(melhorSerie([
  { modo: 'linear', kg: 100, reps: 3, rir: 0 },
  { modo: 'linear', kg: 90, reps: 8, rir: 1 },
  { modo: 'cluster', kg: 120, reps: 7, blocos: [2, 2, 2, 1] },
  { modo: 'linear', kg: 50, reps: null },
]), { kg: 90, reps: 8, rir: 1, rm: 90 * (1 + 9 / 30) }, 'a maior estimativa, sem o cluster');
assert.equal(melhorSerie([{ modo: 'cluster', kg: 120, blocos: [2, 2] }]), null);
assert.equal(melhorSerie([]), null);

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

// ---- dias passados na dieta ----

assert.equal(somaDias('2026-11-02', -1), '2026-11-01');
assert.equal(somaDias('2026-11-01', -1), '2026-10-31', 'vira o mês');
assert.equal(somaDias('2026-01-01', -1), '2025-12-31', 'vira o ano');
assert.equal(somaDias('2026-12-31', 1), '2027-01-01');
assert.equal(somaDias('2028-02-28', 1), '2028-02-29', 'ano bissexto');
assert.equal(somaDias('2026-02-28', 1), '2026-03-01');

const planoMini = {
  refeicoes: [
    { nome: 'Almoço', itens: [{ nome: 'Arroz', kcal: 100 }] },
    { nome: 'Opção', opcaoDe: ['Almoço'], itens: [{ nome: 'Macarrão', kcal: 90 }] },
  ],
};

const diaNovo = montarDia({ data: '2026-10-30', refeicoes: [], agua: 0 }, planoMini);
assert.deepEqual(diaNovo.refeicoes, [{ nome: 'Almoço', itens: [{ nome: 'Arroz', kcal: 100 }], feita: false }]);
assert.equal(diaNovo.doPlano, true);
assert.deepEqual(itensComidos(diaNovo.refeicoes), [], 'abrir um dia passado não conta nada sozinho');

const diaAntigo = montarDia({
  data: '2026-10-29',
  agua: 500,
  refeicoes: [{ nome: 'Jantar', itens: [] }, { nome: 'Almoço', itens: [{ nome: 'Feijão', kcal: 50 }] }],
}, planoMini);
assert.deepEqual(diaAntigo.refeicoes.map((r) => r.nome), ['Almoço', 'Almoço'], 'a vazia sai, a registrada à mão fica');
assert.deepEqual(itensComidos(diaAntigo.refeicoes), [{ nome: 'Feijão', kcal: 50 }], 'o total do dia antigo não muda');
assert.equal(diaAntigo.agua, 500);

const jaMontado = { doPlano: true, refeicoes: [] };
assert.deepEqual(montarDia(jaMontado, planoMini).refeicoes, [], 'ele pode ter tirado tudo: não remonta');

const semPlano = { refeicoes: [] };
assert.equal(montarDia(semPlano, null), semPlano, 'sem plano o dia fica como está');
assert.equal(semPlano.doPlano, undefined, 'e continua podendo receber o plano depois');

// ---- ajuste da foto ----

assert.equal(estiloFoto(null), 'object-position:50% 50%;transform-origin:50% 50%;transform:scale(1)', 'foto sem ajuste fica centralizada');
assert.equal(estiloFoto({ x: 10, y: 20, zoom: 2 }), 'object-position:10% 20%;transform-origin:10% 20%;transform:scale(2)');

// Foto deitada de 2000 x 1000: a maior bolinha tem a altura da foto.
assert.deepEqual(circuloDoAjuste(null, 2000, 1000), { esq: 500, topo: 0, d: 1000 }, 'sem ajuste: centralizada e do maior tamanho');
assert.deepEqual(circuloDoAjuste({ x: 100, y: 50, zoom: 2 }, 2000, 1000), { esq: 1500, topo: 250, d: 500 });

// A bolinha vira ajuste e volta igual, em foto deitada, em pé e quadrada.
for (const [w, h, c] of [
  [2000, 1000, { esq: 300, topo: 120, d: 400 }],
  [1000, 2000, { esq: 120, topo: 900, d: 700 }],
  [1000, 1000, { esq: 10, topo: 20, d: 500 }],
]) {
  const volta = circuloDoAjuste(ajusteDoCirculo(c, w, h), w, h);
  for (const k of ['esq', 'topo', 'd']) assert.ok(Math.abs(volta[k] - c[k]) < 1e-6, `${k} em ${w}x${h}`);
}
assert.deepEqual(ajusteDoCirculo({ esq: 0, topo: 0, d: 1000 }, 1000, 1000), { x: 50, y: 50, zoom: 1 }, 'bolinha do tamanho da foto não divide por zero');

const bola = { esq: 100, topo: 100, d: 400 };
assert.deepEqual(moverCirculo(bola, 50, -20, 2000, 1000), { esq: 150, topo: 80, d: 400 });
assert.deepEqual(moverCirculo(bola, -500, -500, 2000, 1000), { esq: 0, topo: 0, d: 400 }, 'não sai pelo canto de cima');
assert.deepEqual(moverCirculo(bola, 5000, 5000, 2000, 1000), { esq: 1600, topo: 600, d: 400 }, 'nem pelo de baixo');

assert.deepEqual(tamanhoCirculo(bola, 200, 2000, 1000), { esq: 200, topo: 200, d: 200 }, 'mantém o centro');
assert.equal(tamanhoCirculo(bola, 99999, 2000, 1000).d, 1000, 'não passa do lado menor da foto');
assert.equal(tamanhoCirculo(bola, 1, 2000, 1000).d, 1000 / ZOOM_MAXIMO, 'nem do zoom máximo');
assert.deepEqual(tamanhoCirculo({ esq: 0, topo: 0, d: 400 }, 800, 2000, 1000), { esq: 0, topo: 0, d: 800 }, 'no canto, cresce para dentro da foto');

// ---- refeição que se ajusta para bater os macros ----

const somaRef = (itens) => somaMacros(itens);
const perto = (itens, alvo, tolerancia) => ['kcal', 'p', 'c', 'g']
  .every((k) => Math.abs(somaRef(itens)[k] - alvo[k]) <= tolerancia * alvo[k]);
const [cafeP, almocoP, lancheP] = planoReal.refeicoes;
const alvoCafe = somaRef(cafeP.itens);

// Comeu 150 g de banana em vez de 100: o resto se ajusta.
const cafeMexido = cafeP.itens.map((i) => ({ ...i }));
cafeMexido[1] = { ...comQuantidade(cafeMexido[1], 150), fixo: true };
assert.ok(!perto(cafeMexido, alvoCafe, 0.05), 'antes do ajuste, passa do alvo');
const cafeAjustado = adaptarRefeicao(cafeMexido, alvoCafe);
assert.ok(perto(cafeAjustado, alvoCafe, 0.03), 'depois, bate os macros do café com menos de 3% de diferença');
assert.equal(cafeAjustado[1].g_, 150, 'o que ele mexeu fica como ele deixou');
assert.ok(cafeAjustado.every((i, n) => i.fixo || (i.g_ >= cafeP.itens[n].g_ / 2 && i.g_ <= cafeP.itens[n].g_ * 2)),
  'ninguém sai da faixa de metade ao dobro do plano');
assert.ok(cafeAjustado.every((i) => Number.isInteger(i.g_)), 'quantidades em gramas inteiros');
assert.deepEqual(adaptarRefeicao(cafeAjustado, alvoCafe).map((i) => i.g_), cafeAjustado.map((i) => i.g_),
  'ajustar de novo dá o mesmo: não escorrega');

// Frango a mais no almoço: proteína não tem como compensar, mas o feijão e os legumes não somem.
const almocoMexido = almocoP.itens.map((i) => ({ ...i }));
almocoMexido[2] = { ...comQuantidade(almocoMexido[2], 100), fixo: true };
const almocoAjustado = adaptarRefeicao(almocoMexido, somaRef(almocoP.itens));
assert.ok(almocoAjustado[1].g_ >= 40 && almocoAjustado[3].g_ >= 50, 'feijão e legumes continuam no prato');
assert.ok(Math.abs(somaRef(almocoAjustado).kcal - somaRef(almocoP.itens).kcal) < 10, 'as calorias batem');

// O ovo é unidade: não vira meio ovo.
const lancheMexido = lancheP.itens.map((i) => ({ ...i }));
lancheMexido[1] = { ...comQuantidade(lancheMexido[1], 200), fixo: true };
assert.equal(adaptarRefeicao(lancheMexido, somaRef(lancheP.itens))[2].g_, 50);

const tudoFixo = cafeP.itens.map((i) => ({ ...i, fixo: true }));
assert.equal(adaptarRefeicao(tudoFixo, alvoCafe), tudoFixo, 'sem nada solto, nada muda');
assert.doesNotThrow(() => adaptarRefeicao([{ nome: 'X', g_: 0, kcal: 0 }, { nome: 'Y', g_: 100, kcal: 50, p: 1, c: 10, g: 0 }], alvoCafe),
  'item com zero grama não quebra a conta');

// ---- o dia inteiro se ajusta ----

const alvoDia = somaRef(refeicoesDoPlano(planoReal).flatMap((r) => r.itens));
// Almoço já comido com 5 g de azeite a mais: a janta compensa.
const diaTeste = refeicoesDoPlano(planoReal);
const azeiteAlmoco = diaTeste[1].itens.findIndex((i) => i.nome.startsWith('Azeite'));
diaTeste[1].itens[azeiteAlmoco] = { ...comQuantidade(diaTeste[1].itens[azeiteAlmoco], 17), fixo: true };
diaTeste[0].feita = true;
diaTeste[1].feita = true;
const diaAjustado = adaptarDia(diaTeste, alvoDia);
assert.equal(diaAjustado[0], diaTeste[0], 'refeição concluída não muda');
assert.equal(diaAjustado[1], diaTeste[1]);
const azeiteJanta = diaAjustado[3].itens.find((i) => i.nome.startsWith('Azeite')).g_;
assert.ok(azeiteJanta < 12, `o azeite da janta diminui (${azeiteJanta} g)`);
assert.ok(perto(diaAjustado.flatMap((r) => r.itens), alvoDia, 0.01), 'o dia volta a bater as kcal e os macros');
assert.deepEqual(adaptarDia(diaTeste.map((r) => ({ ...r, feita: true })), alvoDia).map((r) => r.itens),
  diaTeste.map((r) => r.itens), 'tudo concluído: nada muda');

console.log('ok: todas as checagens passaram');
