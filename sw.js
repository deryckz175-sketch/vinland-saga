// Cache do app para funcionar em modo avião. Os registros do usuário ficam no
// IndexedDB e não passam por aqui — isto guarda só o código e as tabelas fixas.
// shortcut: troca o cache inteiro a cada versão, sem atualização parcial.
const VERSAO = 'vinland-v3';
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

function guardar(req, resp) {
  const copia = resp.clone();
  caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {});
  return resp;
}

// O código vem da rede primeiro: sem isso uma versão publicada só apareceria
// na segunda vez que o app fosse aberto, e a primeira mostraria a antiga.
// Sem rede, cai no cache e o app continua funcionando igual.
const ehCodigo = (req, url) =>
  req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('manifest.json');

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (ehCodigo(e.request, url)) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => guardar(e.request, resp))
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // Ícones e as tabelas de dados não mudam: cache primeiro.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => guardar(e.request, resp)))
  );
});
