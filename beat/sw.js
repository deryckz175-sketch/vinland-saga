// Cache do Batuque para funcionar sem internet. Os beats ficam no IndexedDB,
// não aqui. Só mexe nos caches com prefixo 'batuque-': o Vinland, no mesmo
// endereço, tem os dele.
const VERSAO = 'batuque-v3';
const ARQUIVOS = [
  './', 'index.html', 'app.js', 'sons.js', 'synth.js', 'motor.js', 'tempo.js', 'wav.js', 'db.js', 'manifest.json',
  'sampler.js', 'gravador.js', 'gravador-worklet.js',
  'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png',
];

const daRede = (url) => fetch(url, { cache: 'no-store' });

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSAO)
      .then((c) => Promise.all(ARQUIVOS.map((u) => daRede(u).then((r) => {
        if (!r.ok) throw new Error(u);
        return c.put(u, r);
      }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('batuque-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function guardar(req, resp) {
  if (resp.ok) {
    const copia = resp.clone();
    caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {});
  }
  return resp;
}

// Código pela rede primeiro (versão nova aparece na hora); sem rede, o cache.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const ehIcone = url.pathname.includes('/icones/');
  if (!ehIcone) {
    e.respondWith(
      daRede(e.request.url)
        .then((resp) => guardar(e.request, resp))
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || daRede(e.request.url).then((resp) => guardar(e.request, resp)))
  );
});
