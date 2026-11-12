// Camada de dados em IndexedDB. Tudo fica no aparelho; nada sai daqui.
// O esquema já contempla os requisitos da etapa 4 para não precisar migrar depois:
// sessoes tem índice por fichaId, porque a carga sugerida vem da última sessão
// daquela ficha, não do último dia em que o exercício apareceu.

import { itensComidos } from './dieta.js';

const BANCO = 'vinland';
const VERSAO = 2;

export const LOJAS = {
  perfil: 'perfil',       // um registro só, id 'eu'; fotoAjuste é a posição e o zoom da foto
  fichas: 'fichas',       // { id, nome, exercicios: [{ nome, series, modo }] }
  sessoes: 'sessoes',     // { id, data, tipo, fichaId, exercicios, minutos }
  dias: 'dias',           // { data, refeicoes: [{ nome, itens, feita }], agua, doPlano }
  alimentos: 'alimentos', // alimentos que o usuário criou
  salvas: 'salvas',       // refeições salvas para repetir: { id, nome, itens }
  config: 'config',       // { chave, valor }
};

let aberto = null;

export function abrir() {
  if (aberto) return aberto;
  aberto = new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (ev.oldVersion < 1) {
        db.createObjectStore(LOJAS.perfil, { keyPath: 'id' });
        db.createObjectStore(LOJAS.fichas, { keyPath: 'id' });
        const s = db.createObjectStore(LOJAS.sessoes, { keyPath: 'id', autoIncrement: true });
        s.createIndex('data', 'data');
        s.createIndex('fichaId', 'fichaId');
        db.createObjectStore(LOJAS.dias, { keyPath: 'data' });
        db.createObjectStore(LOJAS.alimentos, { keyPath: 'id', autoIncrement: true });
        db.createObjectStore(LOJAS.config, { keyPath: 'chave' });
      }
      if (ev.oldVersion < 2) {
        db.createObjectStore(LOJAS.salvas, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      // Se outra aba subir o esquema depois, esta conexão precisa sair da frente,
      // senão é ela que fica travando a outra.
      req.result.onversionchange = () => req.result.close();
      ok(req.result);
    };
    req.onerror = () => falha(req.error);
    // Outra aba aberta na versão anterior impede o upgrade. Sem isto o app
    // ficaria em branco esperando para sempre.
    req.onblocked = () => falha(new Error('bloqueado: o app está aberto em outra aba'));
  });
  return aberto;
}

function pedir(req) {
  return new Promise((ok, falha) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

async function loja(nome, modo = 'readonly') {
  const db = await abrir();
  return db.transaction(nome, modo).objectStore(nome);
}

export async function obter(nome, chave) {
  return pedir((await loja(nome)).get(chave));
}

export async function todos(nome) {
  return pedir((await loja(nome)).getAll());
}

export async function gravar(nome, valor) {
  return pedir((await loja(nome, 'readwrite')).put(valor));
}

export async function apagar(nome, chave) {
  return pedir((await loja(nome, 'readwrite')).delete(chave));
}

// ---- consultas do domínio ----

export async function perfil() {
  return (await obter(LOJAS.perfil, 'eu')) || { id: 'eu', nome: '', peso: null, altura: null, foto: null };
}

export function salvarPerfil(p) {
  return gravar(LOJAS.perfil, { ...p, id: 'eu' });
}

/** Sessões de um dia (chave 'AAAA-MM-DD'). */
export async function sessoesDoDia(data) {
  const l = await loja(LOJAS.sessoes);
  return pedir(l.index('data').getAll(IDBKeyRange.only(data)));
}

/**
 * Datas que têm pelo menos uma sessão, para acender a grade.
 * Percorre só as chaves distintas do índice: não carrega o corpo das sessões.
 */
export async function diasComTreino() {
  const l = await loja(LOJAS.sessoes);
  return new Promise((ok, falha) => {
    const datas = new Set();
    const req = l.index('data').openKeyCursor(null, 'nextunique');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return ok(datas);
      datas.add(c.key);
      c.continue();
    };
    req.onerror = () => falha(req.error);
  });
}

/**
 * Sessões de uma ficha, da mais nova para a mais velha. É daqui que sai a carga
 * sugerida: a extensora do Lower A puxa do Lower A, nunca do Lower B.
 * No mesmo dia vale o gravado por último: ele pode treinar ou corrigir duas vezes num dia.
 */
async function sessoesDaFicha(fichaId) {
  if (!fichaId) return []; // sessão livre não tem ficha, e null não é chave válida
  const l = await loja(LOJAS.sessoes);
  const lista = await pedir(l.index('fichaId').getAll(IDBKeyRange.only(fichaId)));
  return lista.sort((a, b) => (a.data === b.data
    ? String(b.em || '').localeCompare(String(a.em || ''))
    : b.data.localeCompare(a.data)));
}

/**
 * Séries com carga da última vez que cada exercício foi feito NAQUELA ficha, na ordem
 * em que foram feitas. Exercício pulado no último treino da ficha puxa do anterior dela.
 */
export async function cargasAnteriores(fichaId) {
  const mapa = {};
  for (const s of await sessoesDaFicha(fichaId)) {
    for (const ex of s.exercicios || []) {
      if (mapa[ex.nome]) continue;
      const feitas = (ex.series || []).filter((x) => x.kg != null);
      if (feitas.length) mapa[ex.nome] = feitas;
    }
  }
  return mapa;
}

/** Todas as sessões, da mais nova para a mais velha, para a lista de treinos feitos. */
export async function historico() {
  const lista = await todos(LOJAS.sessoes);
  return lista.sort((a, b) => (a.data === b.data
    ? String(b.em || '').localeCompare(String(a.em || ''))
    : b.data.localeCompare(a.data)));
}

/**
 * Última vez que ele fez este exercício, em qualquer treino. É daqui que sai
 * a quantidade de séries de um exercício acrescentado no meio da sessão:
 * ele pediu que viesse com as séries da última vez, não com um número fixo.
 */
export async function ultimaVezDoExercicio(nome) {
  let achado = null;
  for (const s of await todos(LOJAS.sessoes)) {
    const ex = (s.exercicios || []).find((e) => e.nome === nome);
    if (ex && (!achado || s.data > achado.data)) achado = { data: s.data, ex };
  }
  return achado ? achado.ex : null;
}

/**
 * Maior carga já registrada em cada exercício, com a data.
 * Vale entre fichas: um PR no supino é um PR, tenha sido na ficha A ou na C.
 */
export async function recordes() {
  const mapa = {};
  for (const s of await todos(LOJAS.sessoes)) {
    for (const ex of s.exercicios || []) {
      for (const serie of ex.series || []) {
        if (serie.kg == null) continue;
        const atual = mapa[ex.nome];
        if (!atual || serie.kg > atual.kg) mapa[ex.nome] = { kg: serie.kg, reps: serie.reps, data: s.data };
      }
    }
  }
  return mapa;
}

export async function dia(data) {
  return (await obter(LOJAS.dias, data)) || { data, refeicoes: [], agua: 0 };
}

export function salvarDia(d) {
  return gravar(LOJAS.dias, d);
}

/** Dias com refeição concluída, com as kcal somadas, para a grade da dieta. */
export async function diasComDieta() {
  const mapa = {};
  for (const d of await todos(LOJAS.dias)) {
    const kcal = itensComidos(d.refeicoes).reduce((t, i) => t + (i.kcal || 0), 0);
    if (kcal > 0) mapa[d.data] = kcal;
  }
  return mapa;
}

export async function config(chave, padrao = null) {
  const r = await obter(LOJAS.config, chave);
  return r ? r.valor : padrao;
}

export function salvarConfig(chave, valor) {
  return gravar(LOJAS.config, { chave, valor });
}

/** Tudo que está guardado, para o backup da etapa 7. */
export async function exportarTudo() {
  const saida = { versao: VERSAO, em: new Date().toISOString() };
  for (const nome of Object.values(LOJAS)) saida[nome] = await todos(nome);
  return saida;
}
