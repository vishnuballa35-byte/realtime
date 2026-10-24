
const CACHE_NAME = "reeltime-static-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./supabase.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache files individually so one missing optional file
      // doesn't prevent the service worker from installing.
      await Promise.all(
        APP_FILES.map(async (file) => {
          try {
            const response = await fetch(file, { cache: "reload" });
            if (response.ok) {
              await cache.put(file, response);
            }
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
          .filter((key) => key.startsWith("reeltime-static-") &&
                           key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept POST uploads, Supabase API calls,
  // authentication requests, or other external requests.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // For page navigation, try the network first to keep the
  // feed and app page as up to date as possible.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        return (
          await caches.match("./index.html")
        ) || Response.error();
      })
    );
    return;
  }

  // For static assets, use cache first, then network.
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;

      try {
        return await fetch(request);
      } catch (error) {
        return Response.error();
      }
    })
  );
});
