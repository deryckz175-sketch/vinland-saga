// Cache do app para funcionar em modo avião. Os registros do usuário ficam no
// IndexedDB e não passam por aqui — isto guarda só o código e as tabelas fixas.
// shortcut: troca o cache inteiro a cada versão, sem atualização parcial.
const VERSAO = 'vinland-v2';
const ARQUIVOS = [
  './', 'index.html', 'app.js', 'datas.js', 'db.js', 'manifest.json',
  'dados/exercicios.json', 'dados/taco.json',
  'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(e.request, copia)).catch(() => {});
      return resp;
    }).catch(() => hit))
  );
});
