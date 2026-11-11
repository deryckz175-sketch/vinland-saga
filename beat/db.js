// IndexedDB do Batuque: gravações (beats) e amostras importadas nos pads.
// Separado do banco do Vinland ('vinland') — os dois apps não se misturam.

const BANCO = 'batuque';
const VERSAO = 2;
export const GRAVACOES = 'gravacoes'; // { id, nome, criada, atualizada, bpm, dur, eventos, fx, pads }
export const AMOSTRAS = 'amostras';   // { id, nome, wav: ArrayBuffer }
export const MUSICAS = 'musicas';     // { id, nome, dados: ArrayBuffer (arquivo original), dur, criada }
// Gravações têm dois tipos: beat (padrão: eventos dos pads) e { tipo: 'audio', wav, dur }.

let aberto = null;

function abrir() {
  if (aberto) return aberto;
  aberto = new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GRAVACOES)) db.createObjectStore(GRAVACOES, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(AMOSTRAS)) db.createObjectStore(AMOSTRAS, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(MUSICAS)) db.createObjectStore(MUSICAS, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => { aberto = null; falha(req.error); };
  });
  return aberto;
}

async function op(loja, modo, fn) {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(loja, modo);
    const req = fn(tx.objectStore(loja));
    let res;
    if (req) req.onsuccess = () => { res = req.result; };
    tx.oncomplete = () => ok(res);
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error || new Error('abortado'));
  });
}

export const listar = (loja) => op(loja, 'readonly', (s) => s.getAll());
export const pegar = (loja, id) => op(loja, 'readonly', (s) => s.get(id));
export const salvar = (loja, obj) => op(loja, 'readwrite', (s) => s.put(obj));
export const apagar = (loja, id) => op(loja, 'readwrite', (s) => s.delete(id));
export const apagarTudo = (loja) => op(loja, 'readwrite', (s) => s.clear());
export const chaves = (loja) => op(loja, 'readonly', (s) => s.getAllKeys());
