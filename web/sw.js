// Club dei Mari · service worker
// Mette in cache SOLO i file dell'app (interfaccia). I dati del club (turni,
// allenamenti, PDF) NON passano mai da questa cache: arrivano dal server con
// l'autorizzazione dell'utente, così una revoca ha effetto anche offline-online.
const VERSION = 'cdm-shell-2026-11-11-2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/core.js', './js/api.js', './js/config.js', './js/admin.js', './js/workouts.js', './js/workout-parse.js', './js/availability.js', './js/icons.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-48.png',
  './img/logo-tondo.webp', './img/scritta.webp',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // API e PDF: mai in cache
  if (url.pathname.includes('/vendor/')) {
    // pdf.js (solo per Fabio e Mario): cache al primo uso
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); return r; })));
    return;
  }
  // Rete prima (aggiornamenti immediati), cache se offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
