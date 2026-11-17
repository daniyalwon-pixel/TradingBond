// 시황 일지 서비스 워커 — 설치형 앱(PWA)용.
// 앱 화면(index.html)은 항상 네트워크에서 먼저 받아 최신 버전을 쓰고, 오프라인일 때만 저장본을 씁니다.
// 기록 데이터(Supabase)와 외부 라이브러리 요청은 건드리지 않습니다.
const CACHE = 'mj-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-64.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase·CDN·폰트는 그대로 통과

  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
