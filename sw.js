// sw.js
const CACHE_NAME = 'drive-analytics-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/sensors.js',
    '/js/ui.js',
    '/images/icon-192.png',
    '/images/icon-512.png',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css'
];

// インストール時のキャッシュ
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
});

// キャッシュからのレスポンス
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            if (response) {
                return response;
            }
            return fetch(event.request);
        })
    );
}); 