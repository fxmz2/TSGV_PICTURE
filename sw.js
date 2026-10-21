/* Service Worker: macht die App offline nutzbar.
   - index.html: zuerst aus dem Netz (damit Updates sofort ankommen), offline aus dem Zwischenspeicher
   - Bibliotheken, Schriften, Icons: aus dem Zwischenspeicher
   - vereine.txt und Wappen: immer aus dem Netz (werden nie zwischengespeichert)
   Bei jeder neuen App-Version CACHE_VERSION erhöhen. */
const CACHE_VERSION = 'matchshot-v21.2';

const CORE_FILES = [
    './',
    './index.html',
    './manifest.json',
    './matchshot.png',
    './vendor/html2canvas.min.js',
    './vendor/localforage.min.js',
    './vendor/fonts.css',
    './vendor/fonts/bebas-neue-latin-400-normal.woff2',
    './vendor/fonts/big-shoulders-display-latin-800-normal.woff2',
    './vendor/fonts/big-shoulders-display-latin-900-normal.woff2',
    './vendor/fonts/rubik-dirt-latin-400-normal.woff2',
    './vendor/fonts/montserrat-latin-700-normal.woff2',
    './vendor/fonts/montserrat-latin-900-normal.woff2',
    './vendor/fonts/oswald-latin-600-normal.woff2',
    './vendor/fonts/oswald-latin-700-normal.woff2',
    './vendor/fonts/anton-latin-400-normal.woff2',
    './vendor/fonts/archivo-black-latin-400-normal.woff2',
    './vendor/fonts/bangers-latin-400-normal.woff2',
    './vendor/fonts/barlow-condensed-latin-800-normal.woff2',
    './vendor/fonts/barlow-condensed-latin-800-italic.woff2',
    './vendor/fonts/black-ops-one-latin-400-normal.woff2',
    './vendor/fonts/graduate-latin-400-normal.woff2',
    './vendor/fonts/kanit-latin-800-normal.woff2',
    './vendor/fonts/kanit-latin-800-italic.woff2',
    './vendor/fonts/permanent-marker-latin-400-normal.woff2',
    './vendor/fonts/russo-one-latin-400-normal.woff2',
    './vendor/fonts/teko-latin-600-normal.woff2',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './icons/icon-maskable-512.png',
    './icons/favicon-32.png',
    './impressum.html',
    './datenschutz.html',
    './agb.html'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // Einzeln laden: fehlt eine Datei auf dem Server, funktioniert der Rest trotzdem
        await Promise.all(CORE_FILES.map(url =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        ));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

function isCoreAsset(url) {
    const path = url.pathname;
    return path.includes('/vendor/') || path.includes('/icons/') || path.endsWith('/matchshot.png');
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // App-Seiten: Netz zuerst, offline aus dem Cache
    if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_VERSION);
            try {
                const res = await fetch(req);
                if (res.ok) cache.put(req.mode === 'navigate' && url.pathname.endsWith('/') ? './index.html' : req, res.clone());
                return res;
            } catch (e) {
                return (await cache.match(req, { ignoreSearch: true }))
                    || (await cache.match('./index.html'))
                    || Response.error();
            }
        })());
        return;
    }

    // Bibliotheken, Schriften, Icons: Cache zuerst
    if (isCoreAsset(url) || url.pathname.endsWith('manifest.json')) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_VERSION);
            const cached = await cache.match(req, { ignoreSearch: true });
            if (cached) return cached;
            const res = await fetch(req);
            if (res.ok) cache.put(req, res.clone());
            return res;
        })());
    }
    // Alles andere (vereine.txt, Wappen, …) geht direkt ans Netz
});
