// オフライン対応。常にネットワークを優先し、つながらない時だけキャッシュを使う
// （更新がすぐ反映され、古い版が残り続ける問題を避けるため）。
const CACHE = 'wordapp-v3';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/text.js', 'js/importer.js', 'js/speech.js', 'js/settings.js', 'js/ui.js',
  'js/sync.js', 'js/firebase-config.js',
  'js/views/common.js', 'js/views/flow.js', 'js/views/pron.js', 'js/views/list.js', 'js/views/add.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // 自サイトのファイルと、Firebase SDK（gstatic）だけをキャッシュ対象にする
  const cacheable = url.origin === location.origin
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (req.method !== 'GET' || !cacheable) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
