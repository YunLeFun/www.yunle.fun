// Self-destructing service worker to clean up old PWA registration
globalThis.addEventListener('install', () => globalThis.skipWaiting())
globalThis.addEventListener('activate', () => {
  globalThis.registration.unregister()
  globalThis.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach(client => client.navigate(client.url))
  })
})
