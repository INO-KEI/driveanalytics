// sw.js
const CACHE_NAME = 'drive-analytics-v23';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/analysis.js',
    './js/sensors.js',
    './js/charts.js',
    './js/ui.js',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon-512-maskable.png',
    './images/apple-touch-icon.png',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.filter(function(key) {
                return key !== CACHE_NAME;
            }).map(function(key) {
                return caches.delete(key);
            }));
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') {
        return;
    }
    event.respondWith(
        fetch(event.request).then(function(response) {
            if (response && response.status === 200 && response.type !== 'opaque') {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, copy);
                });
            }
            return response;
        }).catch(function() {
            return caches.match(event.request);
        })
    );
});
