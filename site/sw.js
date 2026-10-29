const VERSION = 'dev';
const CACHE = 'blog-editor-' + VERSION;
const SHELL = [
  '/write', '/write.js', '/desk.js', '/sync.js', '/theme.js', '/lib/post.js',
  '/style.css', '/fonts/Inconsolata.woff2', '/manifest.json', '/icons/icon-512.png', '/favicon.svg', '/learns.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blog-editor') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(url.pathname))
      .then((copy) => copy || fetch(event.request)),
  );
});
