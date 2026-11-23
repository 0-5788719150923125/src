// The site's service worker: WebTorrent's streaming worker (vendored, see
// scripts/vendor.js), plus one thing it lacks. It claims the pages it
// controls only when it activates, so a page loaded without it (a hard
// reload, or a tab the browser restored) could never stream until reloaded.
// Such a page asks, and is claimed (torrent.js).
importScripts('./vendor/webtorrent-sw.js')

self.addEventListener('message', (event) => {
    if (event.data === 'claim') event.waitUntil(self.clients.claim())
})
