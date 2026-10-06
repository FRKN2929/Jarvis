// JARVIS Mobile – Service Worker
// App-Shell: network-first (Updates kommen sofort an), Cache als Offline-Fallback.
// CDN-Module (WebLLM / wllama): cache-first, sie sind versioniert.
// /api/* und Modell-Downloads (Hugging Face) werden nie angefasst –
// WebLLM/wllama verwalten ihren Modell-Cache selbst.
const SHELL = 'jarvis-shell-v16';
const CDN = 'jarvis-cdn-v16';
const SHELL_FILES = [
  './', 'index.html', 'app.js', 'brain.js', 'make.js', 'manifest.webmanifest',
  'icon.png', 'apple-touch-icon.png', 'Saira.ttf', 'JetBrainsMono.ttf',
  'pptxgen.bundle.js', 'jspdf.umd.min.js', 'jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jarvis-') && k !== SHELL && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // live, nie cachen
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(CDN).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }))),
    );
  }
  // alles andere (Hugging Face, Wetter-/Krypto-APIs): normal durchs Netz
});
