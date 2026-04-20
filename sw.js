const CACHE_NAME = "pulse-oee-demo-v14";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=20260420-v1.8.1",
  "./app.js?v=20260420-v1.8.1",
  "./manifest.webmanifest",
  "./icons/icon-app.svg",
  "./icons/apple-touch-icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isNavigation = event.request.mode === "navigate";

  if (!isSameOrigin) {
    event.respondWith(fetch(event.request).catch(function () {
      return caches.match(event.request);
    }));
    return;
  }

  event.respondWith(
    fetch(event.request).then(function (networkResponse) {
      const responseClone = networkResponse.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(event.request, responseClone);
      });
      return networkResponse;
    }).catch(function () {
      return caches.match(event.request).then(function (cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }

        if (isNavigation) {
          return caches.match("./index.html");
        }

        throw new Error("Recurso no disponible");
      });
    })
  );
});
