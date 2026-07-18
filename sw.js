/* AI 손주 — 서비스 워커
   네트워크 우선 + 캐시 폴백: 항상 최신을 시도하고, 오프라인이면 캐시로 연다.
   덕분에 한 번 방문한 뒤에는 인터넷 없이도 앱이 켜진다 (기록·저장된 연습 사용 가능). */

const CACHE = "ai-sonju-v1";
const CORE = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/practice.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // AI API 호출이나 외부 리소스는 건드리지 않는다
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
