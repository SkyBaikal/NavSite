// NavSite Service Worker — PWA 离线兜底
// 策略：
//   - 应用外壳（/、构建产物、图标）：cache-first + 后台更新（stale-while-revalidate）
//   - /api/*：network-first，失败回退缓存（GET），POST 永不缓存
//   - 上游代理（/api/rss /api/weather /api/dailyshot /api/image /api/favicon）：服务端本就有缓存兜底，SW 再挡一层断网
const SHELL_CACHE = 'navsite-shell-v1';
const API_CACHE = 'navsite-api-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, API_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // POST/登录等永不拦截
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API：network-first，失败读缓存
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || new Response(JSON.stringify({ code: 'OFFLINE', message: '离线' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    );
    return;
  }

  // 外壳与静态资源：stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => hit);
      return hit || fetching;
    })
  );
});
