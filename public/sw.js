const CACHE_VERSION = "orbinex-pwa-v2";
const CORE_CACHE = `${CACHE_VERSION}-core`;
const DB_CACHE = `${CACHE_VERSION}-db`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const CORE_ASSETS = [
    "./",
    "./index.html",
    "./ar-view.html",
    "./manifest.webmanifest",
    "./orbinex-logo.svg",
    "./orbinex.png",
    "./db/cn2tw_1.json",
    "./db/tw2cn_1.json",
    "./data/agency-catalog.json"
];

const DB_ASSETS = [
    "./db/cn2tw_1.json",
    "./db/tw2cn_1.json",
    "./data/agency-catalog.json"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CORE_CACHE)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter((key) => key.startsWith("orbinex-pwa-") && !key.startsWith(CACHE_VERSION))
                .map((key) => caches.delete(key))
        );
        await self.clients.claim();
    })());
});

async function cacheDbAssets() {
    const cache = await caches.open(DB_CACHE);
    await Promise.all(DB_ASSETS.map(async (assetUrl) => {
        try {
            const response = await fetch(assetUrl, { cache: "no-cache" });
            if (response.ok || response.type === "opaque") {
                await cache.put(assetUrl, response.clone());
            }
        } catch {
            // Skip failed downloads, retry next trigger.
        }
    }));
}

self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") {
        return;
    }

    if (data.type === "CACHE_DB_NOW") {
        event.waitUntil(cacheDbAssets());
    }
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    try {
        const network = await fetch(request);
        if (network.ok || network.type === "opaque") {
            await cache.put(request, network.clone());
        }
        return network;
    } catch {
        return new Response("Offline", { status: 503, statusText: "Offline" });
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const networkPromise = fetch(request)
        .then((response) => {
            if (response.ok || response.type === "opaque") {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cached || networkPromise || new Response("Offline", { status: 503, statusText: "Offline" });
}

async function networkFirstNavigate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const network = await fetch(request);
        if (network.ok || network.type === "opaque") {
            await cache.put(request, network.clone());
        }
        return network;
    } catch {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        const fallback = await cache.match("./index.html");
        return fallback || new Response("Offline", { status: 503, statusText: "Offline" });
    }
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    if (url.pathname.includes("/db/") || url.pathname.includes("/data/")) {
        event.respondWith(cacheFirst(request, DB_CACHE));
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(networkFirstNavigate(request));
        return;
    }

    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
