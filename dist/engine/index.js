"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENGINE_CONSTANTS = exports.engine = void 0;
exports.search = search;
exports.getFeatured = getFeatured;
exports.getTrending = getTrending;
exports.getByCategory = getByCategory;
exports.getDaily = getDaily;
exports.warmCache = warmCache;
exports.startCacheWarmScheduler = startCacheWarmScheduler;
exports.stopCacheWarmScheduler = stopCacheWarmScheduler;
exports.healthCheck = healthCheck;
exports.getStats = getStats;
// This is the heart of the product.
// Every UI or script should ideally talk only to this file.
const cache_1 = require("../cache");
const clients_1 = require("../clients");
const config_1 = require("../config");
Object.defineProperty(exports, "ENGINE_CONSTANTS", { enumerable: true, get: function () { return config_1.ENGINE_CONSTANTS; } });
const normalizers_1 = require("../normalizers");
const quota_1 = require("../quota");
const router_1 = require("../router");
const storage_1 = require("../storage");
const utils_1 = require("../utils");
// These runtime metrics back `getStats()` and help explain engine behavior over time.
const engineStartedAt = Date.now();
const freshLatencies = [];
const cachedLatencies = [];
let totalRequests = 0;
let totalErrors = 0;
let cacheWarmTimer = null;
// Whenever we return real remote results, quietly save thumbnails/previews in the background.
function primeSearchBundleCache(wallpapers) {
    if (!config_1.FEATURE_FLAGS.enableOfflineBundle) {
        return;
    }
    void Promise.allSettled(wallpapers
        .filter((wallpaper) => wallpaper.source !== "local")
        .map((wallpaper) => (0, utils_1.cacheWallpaperBundle)(wallpaper)));
}
// Small helper so the main pipeline does not repeat the same source-call boilerplate five times.
async function trySource(source, request) {
    const client = (0, clients_1.getClient)(source);
    const response = await client(request);
    (0, quota_1.recordUsage)(source, {
        success: true,
        latencyMs: response.latencyMs
    });
    const normalizer = (0, normalizers_1.getNormalizer)(source);
    return (0, utils_1.dedupeWallpapers)(normalizer(response)).slice(0, request.perPage);
}
// Favorites live outside the engine pipeline, so we decorate results just before returning them.
// Favorites are not stored inside provider data, so we attach them right before returning results outward.
function decorateFavorites(wallpapers) {
    return wallpapers.map((wallpaper) => ({
        ...wallpaper,
        isFavorite: (0, storage_1.isFavorite)(wallpaper.id)
    }));
}
// Turns a loose public request into a strict internal request the rest of the engine can trust.
// Sanitizes public input once so everything downstream can trust the request shape.
function buildRequest(input) {
    const mode = input.mode ?? "search";
    const category = (0, router_1.resolveCategory)(input.query, input.category);
    return (0, utils_1.normalizeQuery)({
        query: input.query.trim(),
        category,
        page: (0, utils_1.clamp)(input.page ?? 1, 1, 999),
        perPage: (0, utils_1.clamp)(input.perPage ?? config_1.REQUEST_DEFAULTS.perPage, 1, config_1.REQUEST_DEFAULTS.maxPerPage),
        mode
    });
}
// This is the full backend pipeline:
// cache -> router -> client -> normalizer -> cache write -> return.
async function runPipeline(request) {
    totalRequests += 1;
    const startedAt = Date.now();
    const cacheKey = (0, cache_1.generateCacheKey)(request.query, request.category, request.page, request.mode);
    const cached = (0, cache_1.cacheGet)(cacheKey);
    // Fastest path: exact request cache hit.
    if (cached) {
        cachedLatencies.push(Math.max(1, Date.now() - startedAt));
        return decorateFavorites(cached.data);
    }
    // Second-fastest path: local bundle search.
    // This is what prevents repeat browsing from spending API quota.
    const localResults = (0, cache_1.localBundleSearch)(request.query, request.category, request.page, request.perPage);
    if (localResults.length > 0) {
        (0, cache_1.cacheSet)(cacheKey, localResults, config_1.CACHE_SETTINGS.ttlMs, config_1.CACHE_SETTINGS.staleTtlMs);
        cachedLatencies.push(Math.max(1, Date.now() - startedAt));
        return decorateFavorites(localResults);
    }
    // Only after exact cache and local DB do we spend remote quota.
    const decision = (0, router_1.pickSource)(request);
    for (const source of decision.chain) {
        try {
            const wallpapers = await trySource(source, request);
            // Successful remote results are saved both as exact request cache and as searchable bundle content.
            if (wallpapers.length > 0) {
                (0, cache_1.localBundleUpsert)(wallpapers);
                (0, cache_1.cacheSet)(cacheKey, wallpapers, config_1.CACHE_SETTINGS.ttlMs, config_1.CACHE_SETTINGS.staleTtlMs);
                primeSearchBundleCache(wallpapers);
                freshLatencies.push(Date.now() - startedAt);
                if (request.mode === "search" && request.query.trim()) {
                    (0, storage_1.addSearchHistory)(request.query);
                }
                return decorateFavorites(wallpapers);
            }
        }
        catch (error) {
            totalErrors += 1;
            (0, quota_1.recordUsage)(source, {
                success: false
            });
            console.error(`[engine] Source ${source} failed`, error);
        }
    }
    // If remote sources all fail, try stale exact-cache data before the final live fallback.
    const stale = (0, cache_1.cacheGet)(cacheKey, {
        allowStale: true
    });
    if (stale) {
        cachedLatencies.push(Math.max(1, Date.now() - startedAt));
        return decorateFavorites(stale.data);
    }
    // Final live source.
    const ultimateFallbackSource = (0, router_1.getUltimateFallbackSource)();
    if (ultimateFallbackSource) {
        try {
            const fallbackResults = await trySource(ultimateFallbackSource, request);
            if (fallbackResults.length > 0) {
                (0, cache_1.localBundleUpsert)(fallbackResults);
                (0, cache_1.cacheSet)(cacheKey, fallbackResults, config_1.CACHE_SETTINGS.ttlMs, config_1.CACHE_SETTINGS.staleTtlMs);
                primeSearchBundleCache(fallbackResults);
                freshLatencies.push(Date.now() - startedAt);
                return decorateFavorites(fallbackResults);
            }
        }
        catch (error) {
            totalErrors += 1;
            (0, quota_1.recordUsage)(ultimateFallbackSource, {
                success: false
            });
            console.error(`[engine] Ultimate fallback ${ultimateFallbackSource} failed`, error);
        }
    }
    // Absolute last resort: generated offline wallpapers so the engine still returns something valid.
    const offline = (0, utils_1.createOfflineWallpapers)(request);
    (0, cache_1.localBundleUpsert)(offline);
    (0, cache_1.cacheSet)(cacheKey, offline, config_1.CACHE_SETTINGS.ttlMs, config_1.CACHE_SETTINGS.staleTtlMs);
    freshLatencies.push(Date.now() - startedAt);
    return decorateFavorites(offline);
}
// Public search entry point used by category pages, free-form search, and future UI screens.
async function search(query, category, page = 1) {
    const payload = {
        query,
        page,
        mode: "search"
    };
    if (category) {
        payload.category = category;
    }
    return runPipeline(buildRequest(payload));
}
// Returns one themed set based on the current day so "featured" feels curated instead of random.
// This is "featured" in the current backend sense: a rotating curated query set, not a true editorial CMS.
async function getFeatured() {
    const index = (0, utils_1.getDayOfYear)() % config_1.FEATURED_ROTATION.length;
    const featured = config_1.FEATURED_ROTATION[index] ?? config_1.FEATURED_ROTATION[0];
    return runPipeline(buildRequest({
        query: featured.query,
        category: featured.category,
        page: 1,
        mode: "featured"
    }));
}
// Category browsing is just a specialized search with a generated default query.
async function getByCategory(category, page = 1) {
    return runPipeline(buildRequest({
        query: (0, router_1.getDefaultQueryForCategory)(category),
        category,
        page,
        mode: "category"
    }));
}
// Trending is intentionally lightweight for now: it uses a generic high-intent wallpaper query
// and still benefits from the same routing, caching, and fallback behavior as search.
// "Trending" is currently implemented as a smart generic search query.
async function getTrending(page = 1) {
    return runPipeline(buildRequest({
        query: "trending wallpaper",
        category: "all",
        page,
        mode: "featured"
    }));
}
// Daily wallpaper prefers NASA APOD but still guarantees a result if NASA is unavailable.
async function getDaily() {
    const cacheKey = (0, cache_1.generateCacheKey)("daily", "space", 1, "daily");
    const cached = (0, cache_1.cacheGet)(cacheKey);
    if (cached?.data[0]) {
        return decorateFavorites([cached.data[0]])[0] ?? cached.data[0];
    }
    const [wallpaper] = await runPipeline(buildRequest({
        query: "astronomy picture of the day",
        category: "space",
        page: 1,
        perPage: 1,
        mode: "daily"
    }));
    const fallbackDaily = (0, utils_1.createOfflineWallpapers)(buildRequest({
        query: "astronomy picture of the day",
        category: "space",
        page: 1,
        perPage: 1,
        mode: "daily"
    }));
    const result = wallpaper ?? fallbackDaily[0];
    (0, cache_1.cacheSet)(cacheKey, [result], config_1.CACHE_SETTINGS.ttlMs, config_1.CACHE_SETTINGS.staleTtlMs);
    return result;
}
// Warm a small set of high-value categories so the app can start in a fast cache-first state.
// Warming cache is how the backend starts behaving more like a local content engine over time.
async function warmCache(categories = config_1.CACHE_SETTINGS.prefetchCategories) {
    const warmed = {};
    for (const category of categories) {
        const results = await getByCategory(category, 1);
        primeSearchBundleCache(results);
        warmed[category] = results.length;
    }
    return warmed;
}
// Lets the backend periodically prime high-value categories so first user requests are faster.
// Background warming is optional and host-controlled.
function startCacheWarmScheduler(intervalMs = 1000 * 60 * 60 * 6, categories = config_1.CACHE_SETTINGS.prefetchCategories) {
    if (cacheWarmTimer) {
        clearInterval(cacheWarmTimer);
    }
    cacheWarmTimer = setInterval(() => {
        void warmCache(categories).catch((error) => {
            console.error("[engine] Cache warm scheduler failed", error);
        });
    }, intervalMs);
    return {
        intervalMs,
        categories: [...categories]
    };
}
// Stops the background warmer so tests and future hosts can shut down cleanly.
// Clean shutdown helper for tests and future app lifecycle hooks.
function stopCacheWarmScheduler() {
    if (!cacheWarmTimer) {
        return;
    }
    clearInterval(cacheWarmTimer);
    cacheWarmTimer = null;
}
// This is the operator view of the system: source health plus cache state.
async function healthCheck() {
    const quota = (0, quota_1.getQuotaReport)();
    const cache = (0, cache_1.cacheStats)();
    const operational = quota.picsum.healthy || cache.size > 0;
    return {
        unsplash: quota.unsplash,
        pexels: quota.pexels,
        pixabay: quota.pixabay,
        nasa: quota.nasa,
        picsum: quota.picsum,
        cache,
        overall: operational ? "ALL SYSTEMS OPERATIONAL" : "DEGRADED - OFFLINE BUNDLE ONLY"
    };
}
// This is the product analytics view: request counts, cache efficiency, and latency trends.
async function getStats() {
    const quota = (0, quota_1.getQuotaReport)();
    const cache = (0, cache_1.cacheStats)();
    return {
        totalRequests,
        cacheHits: cache.hits + cache.staleHits,
        cacheMisses: cache.misses,
        avgResponseFresh: (0, utils_1.average)(freshLatencies),
        avgResponseCached: (0, utils_1.average)(cachedLatencies),
        apiUsage: {
            unsplash: quota.unsplash.totalRequests,
            pexels: quota.pexels.totalRequests,
            pixabay: quota.pixabay.totalRequests,
            nasa: quota.nasa.totalRequests,
            picsum: quota.picsum.totalRequests
        },
        errors: totalErrors,
        uptime: (0, utils_1.formatUptime)(engineStartedAt)
    };
}
// The UI should only need this object, not the internals behind it.
// This exported object is the intended public backend surface.
exports.engine = {
    search,
    getFeatured,
    getTrending,
    getByCategory,
    getDaily,
    warmCache,
    startCacheWarmScheduler,
    stopCacheWarmScheduler,
    healthCheck,
    getStats
};
