// ⚠️ 정적 자산이나 CDN 목록을 바꾸면 CACHE_NAME 버전을 반드시 올리세요.
// 올리지 않으면 기존 방문자는 낡은 캐시를 계속 사용합니다.
const CACHE_NAME = 'todoc-crm-v2';
const STATIC_ASSETS = [
  '/',
  '/static/tailwind.css',
  '/static/style.css',
  '/static/app.js',
  '/static/manifest.json',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png'
];

// 참고: 이 목록은 현재 어디에서도 참조되지 않습니다(선언만 존재).
// CDN 자산은 아래 fetch 핸들러가 cross-origin 요청을 만날 때
// cache-first로 런타임 캐싱하므로 사전 캐싱은 불필요합니다.
// 목록 자체는 문서화 목적으로 남기되, 존재하지 않는 URL은 넣지 마세요
// (사전 캐싱에 다시 쓰게 되면 cache.addAll이 전체 실패합니다).
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  'https://cdn.jsdelivr.net/npm/axios@1.7.0/dist/axios.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('SW: Some static assets failed to cache', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy: Network-first for API, Cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API requests: network-only (no caching)
  if (url.pathname.startsWith('/api/')) return;

  // CDN assets: cache-first with network fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
