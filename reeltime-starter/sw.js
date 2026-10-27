// ReelTime service worker.
// Change CACHE_NAME (v3, v4 ...) whenever you want to force a refresh.
const CACHE_NAME = "reeltime-static-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./instagram-extras.css",
  "./supabase.js",
  "./app.js",
  "./e2ee.js",
  "./instagram-extras.js",
  "./chat-security.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // One missing file must not stop the install.
      await Promise.all(
        APP_FILES.map(async (file) => {
          try {
            const response = await fetch(file, { cache: "reload" });
            if (response.ok) await cache.put(file, response);
          } catch (error) {
            console.warn("Could not cache:", file);
          }
        })
      );

      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("reeltime-static-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch uploads, Supabase calls, login requests or other sites.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Network first, so new code always shows up. The cache is only the
  // fallback when you are offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        return (
          (await caches.match(request)) ||
          (request.mode === "navigate" && (await caches.match("./index.html"))) ||
          Response.error()
        );
      })
  );
});
