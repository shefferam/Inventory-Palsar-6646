// App-shell cache so the installed app opens without a connection.
// Network-first: online users always get the latest files; the cache is only a fallback.
// Data requests (Google Sheets / Firestore) are cross-origin and never touched here.
const CACHE = "palsar-shell-v2";
const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/styles.css",
  "assets/Palsar.jpeg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "js/actions.js",
  "js/app.js",
  "js/auth.js",
  "js/config.js",
  "js/dialogs.js",
  "js/firebase-config.js",
  "js/firebase.js",
  "js/history.js",
  "js/reports.js",
  "js/soldiers.js",
  "js/splash.js",
  "js/state.js",
  "js/ui.js",
  "js/users.js",
  "js/views.js",
  "js/data/firestore-adapter.js",
  "js/data/local-adapter.js",
  "js/data/model.js",
  "js/data/repository.js",
  "js/data/schema.js",
  "js/data/seed.js",
  "js/data/sheets-adapter.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: "no-cache" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" revalidates with the server, so a mix of old and new modules is never served.
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true }))
        ?? (req.mode === "navigate" ? caches.match("index.html") : Response.error())),
  );
});
