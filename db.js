// Camada de dados em IndexedDB. Tudo fica no aparelho; nada sai daqui.
// O esquema já contempla os requisitos da etapa 4 para não precisar migrar depois:
// sessoes tem índice por fichaId, porque a carga sugerida vem da última sessão
// daquela ficha, não do último dia em que o exercício apareceu.

const BANCO = 'vinland';
const VERSAO = 1;

export const LOJAS = {
  perfil: 'perfil',       // um registro só, id 'eu'
  fichas: 'fichas',       // { id, nome, titulo, exercicios: [{ nome, series, modo }] }
  sessoes: 'sessoes',     // { id, data, fichaId, exercicios, minutos }
  dias: 'dias',           // { data, refeicoes: [...], agua }
  alimentos: 'alimentos', // alimentos que o usuário criou
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
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
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
 * Última sessão de uma ficha. É daqui que sai a carga sugerida:
 * a extensora da ficha A puxa a carga da última ficha A, não do último
 * dia em que ele fez extensora em qualquer treino.
 */
export async function ultimaSessaoDaFicha(fichaId) {
  const l = await loja(LOJAS.sessoes);
  const lista = await pedir(l.index('fichaId').getAll(IDBKeyRange.only(fichaId)));
  if (!lista.length) return null;
  return lista.reduce((a, b) => (a.data >= b.data ? a : b));
}

/** Cargas da última vez naquela ficha, por nome de exercício. */
export async function cargasAnteriores(fichaId) {
  const s = await ultimaSessaoDaFicha(fichaId);
  const mapa = {};
  if (!s) return mapa;
  for (const ex of s.exercicios || []) {
    const feitas = (ex.series || []).filter((x) => x.kg != null);
    if (feitas.length) mapa[ex.nome] = { kg: feitas[0].kg, reps: feitas[0].reps };
  }
  return mapa;
}

export async function dia(data) {
  return (await obter(LOJAS.dias, data)) || { data, refeicoes: [], agua: 0 };
}

export function salvarDia(d) {
  return gravar(LOJAS.dias, d);
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
