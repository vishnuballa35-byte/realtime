// =====================================================
// ReelTime — service worker
// Makes the app installable and lets it open even when
// the connection drops. It never touches Supabase data
// or videos (those always come live from the internet).
// =====================================================

const CACHE = "reeltime-shell-v2";
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

const SHELL = [
  "./",
  "index.html",
  "style.css",
  "instagram-extras.css",
  "app.js",
  "instagram-extras.js",
  "supabase.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  SUPABASE_JS
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not stop the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// Network first: you always get your newest files when online,
// and the saved copy is used only when the network fails.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    // "no-cache" = check with the server first, so old CSS/JS is never reused.
    // (Page loads themselves are left alone to avoid redirect problems.)
    const response = await fetch(
      request,
      request.mode === "navigate" ? undefined : { cache: "no-cache" }
    );

    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);

    if (cached) return cached;

    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }

    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;
  if (request.headers.has("range")) return; // video streaming

  const url = new URL(request.url);
  const ownFile = url.origin === self.location.origin;

  // Supabase (database, login, videos, photos) is never cached.
  if (!ownFile && request.url !== SUPABASE_JS) return;

  event.respondWith(networkFirst(request));
});