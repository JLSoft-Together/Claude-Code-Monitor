// App shell only: the dashboard itself is live data over /ws, so nothing dynamic is ever cached.
const CACHE = 'ccm-shell-v1'
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(fallback ?? request, res.clone())
    return res
  } catch {
    return (await cache.match(fallback ?? request)) ?? Response.error()
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  // A missing hashed asset falls back to index.html with 200; never pin that under the asset URL.
  if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/ws' || url.pathname === '/health') return
  if (req.mode === 'navigate') event.respondWith(networkFirst(req, '/'))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(req))
  else event.respondWith(networkFirst(req))
})
