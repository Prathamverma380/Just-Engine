// This is the heart of the product.
// Every UI or script should ideally talk only to this file.
import {
  cacheGet,
  cacheSet,
  cacheStats,
  generateCacheKey,
  localBundleSearch,
  localBundleUpsert
} from "../cache";
import { getClient } from "../clients";
import {
  CACHE_SETTINGS,
  ENGINE_CONSTANTS,
  FEATURED_ROTATION,
  FEATURE_FLAGS,
  REQUEST_DEFAULTS
} from "../config";
import { getNormalizer } from "../normalizers";
import { searchBundledOfflineWallpapers } from "../offline/bundle";
import { getQuotaReport, recordUsage } from "../quota";
import { getDefaultQueryForCategory, getUltimateFallbackSource, pickSource, resolveCategory } from "../router";
import { addSearchHistory, isFavorite } from "../storage";
import type {
  ApiClientRequest,
  EngineHealthReport,
  EngineStats,
  SearchQuery,
  Wallpaper
} from "../types/wallpaper";
import {
  average,
  cacheWallpaperBundle,
  clamp,
  createOfflineWallpapers,
  dedupeWallpapers,
  formatUptime,
  getDayOfYear,
  normalizeQuery
} from "../utils";

// These runtime metrics back `getStats()` and help explain engine behavior over time.
const engineStartedAt = Date.now();
const freshLatencies: number[] = [];
const cachedLatencies: number[] = [];
let totalRequests = 0;
let totalErrors = 0;
let cacheWarmTimer: ReturnType<typeof setInterval> | null = null;

// Whenever we return real remote results, quietly save thumbnails/previews in the background.
function primeSearchBundleCache(wallpapers: Wallpaper[]): void {
  if (!FEATURE_FLAGS.enableOfflineBundle) {
    return;
  }

  void Promise.allSettled(
    wallpapers
      .filter((wallpaper) => wallpaper.source !== "local")
      .map((wallpaper) => cacheWallpaperBundle(wallpaper))
  );
}

// Small helper so the main pipeline does not repeat the same source-call boilerplate five times.
async function trySource(source: "unsplash" | "pexels" | "pixabay" | "nasa" | "picsum", request: ApiClientRequest) {
  const client = getClient(source);
  const response = await client(request);
  recordUsage(source, {
    success: true,
    latencyMs: response.latencyMs,
    rateLimit: response.rateLimit
  });

  const normalizer = getNormalizer(source);
  return dedupeWallpapers(normalizer(response)).slice(0, request.perPage);
}

// Favorites live outside the engine pipeline, so we decorate results just before returning them.
// Favorites are not stored inside provider data, so we attach them right before returning results outward.
function decorateFavorites(wallpapers: Wallpaper[]): Wallpaper[] {
  return wallpapers.map((wallpaper) => ({
    ...wallpaper,
    isFavorite: isFavorite(wallpaper.id)
  }));
}

// Turns a loose public request into a strict internal request the rest of the engine can trust.
// Sanitizes public input once so everything downstream can trust the request shape.
function buildRequest(input: SearchQuery): ApiClientRequest {
  const mode = input.mode ?? "search";
  const category = resolveCategory(input.query, input.category);

  return normalizeQuery({
    query: input.query.trim(),
    category,
    page: clamp(input.page ?? 1, 1, 999),
    perPage: clamp(input.perPage ?? REQUEST_DEFAULTS.perPage, 1, REQUEST_DEFAULTS.maxPerPage),
    mode
  });
}

// This is the full backend pipeline:
// cache -> router -> client -> normalizer -> cache write -> return.
async function runPipeline(request: ApiClientRequest): Promise<Wallpaper[]> {
  totalRequests += 1;
  const startedAt = Date.now();
  const cacheKey = generateCacheKey(request.query, request.category, request.page, request.mode);
  const cached = cacheGet(cacheKey);

  // Fastest path: exact request cache hit.
  if (cached) {
    cachedLatencies.push(Math.max(1, Date.now() - startedAt));
    return decorateFavorites(cached.data);
  }

  // Second-fastest path: local bundle search.
  // This is what prevents repeat browsing from spending API quota.
  const localResults = localBundleSearch(request.query, request.category, request.page, request.perPage);
  if (localResults.length > 0) {
    cacheSet(cacheKey, localResults, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
    cachedLatencies.push(Math.max(1, Date.now() - startedAt));
    return decorateFavorites(localResults);
  }

  // Only after exact cache and local DB do we spend remote quota.
  const decision = pickSource(request);

  for (const source of decision.chain) {
    try {
      const wallpapers = await trySource(source, request);

      // Successful remote results are saved both as exact request cache and as searchable bundle content.
      if (wallpapers.length > 0) {
        localBundleUpsert(wallpapers);
        cacheSet(cacheKey, wallpapers, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
        primeSearchBundleCache(wallpapers);
        freshLatencies.push(Date.now() - startedAt);
        if (request.mode === "search" && request.query.trim()) {
          addSearchHistory(request.query);
        }
        return decorateFavorites(wallpapers);
      }
    } catch (error) {
      totalErrors += 1;
      recordUsage(source, {
        success: false
      });
      console.error(`[engine] Source ${source} failed`, error);
    }
  }

  // If remote sources all fail, try stale exact-cache data before the final live fallback.
  const stale = cacheGet(cacheKey, {
    allowStale: true
  });

  if (stale) {
    cachedLatencies.push(Math.max(1, Date.now() - startedAt));
    return decorateFavorites(stale.data);
  }

  // Final live source.
  const ultimateFallbackSource = getUltimateFallbackSource();

  if (ultimateFallbackSource) {
    try {
      const fallbackResults = await trySource(ultimateFallbackSource, request);
      if (fallbackResults.length > 0) {
        localBundleUpsert(fallbackResults);
        cacheSet(cacheKey, fallbackResults, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
        primeSearchBundleCache(fallbackResults);
        freshLatencies.push(Date.now() - startedAt);
        return decorateFavorites(fallbackResults);
      }
    } catch (error) {
      totalErrors += 1;
      recordUsage(ultimateFallbackSource, {
        success: false
      });
      console.error(`[engine] Ultimate fallback ${ultimateFallbackSource} failed`, error);
    }
  }

  // Shipped offline bundle: real curated local wallpapers embedded with the engine.
  const bundledOffline = searchBundledOfflineWallpapers(request);
  if (bundledOffline.length > 0) {
    localBundleUpsert(bundledOffline);
    cacheSet(cacheKey, bundledOffline, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
    cachedLatencies.push(Math.max(1, Date.now() - startedAt));
    return decorateFavorites(bundledOffline);
  }

  // Absolute last resort after the shipped bundle: generated offline wallpapers so the engine still returns something valid.
  const offline = createOfflineWallpapers(request);
  localBundleUpsert(offline);
  cacheSet(cacheKey, offline, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
  freshLatencies.push(Date.now() - startedAt);
  return decorateFavorites(offline);
}

// Public search entry point used by category pages, free-form search, and future UI screens.
async function search(query: string, category?: string, page = 1): Promise<Wallpaper[]> {
  const payload: SearchQuery = {
    query,
    page,
    mode: "search"
  };

  if (category) {
    payload.category = category;
  }

  return runPipeline(
    buildRequest(payload)
  );
}

// The original doc calls this `getWallpapers`, so keep that public alias for hosts that want the explicit name.
async function getWallpapers(query: string, category?: string, page = 1): Promise<Wallpaper[]> {
  return search(query, category, page);
}

// Returns one themed set based on the current day so "featured" feels curated instead of random.
// This is "featured" in the current backend sense: a rotating curated query set, not a true editorial CMS.
async function getFeatured(): Promise<Wallpaper[]> {
  const index = getDayOfYear() % FEATURED_ROTATION.length;
  const featured = FEATURED_ROTATION[index] ?? FEATURED_ROTATION[0];

  return runPipeline(
    buildRequest({
      query: featured.query,
      category: featured.category,
      page: 1,
      mode: "featured"
    })
  );
}

// Category browsing is just a specialized search with a generated default query.
async function getByCategory(category: string, page = 1): Promise<Wallpaper[]> {
  return runPipeline(
    buildRequest({
      query: getDefaultQueryForCategory(category),
      category,
      page,
      mode: "category"
    })
  );
}

// Trending is intentionally lightweight for now: it uses a generic high-intent wallpaper query
// and still benefits from the same routing, caching, and fallback behavior as search.
// "Trending" is currently implemented as a smart generic search query.
async function getTrending(page = 1): Promise<Wallpaper[]> {
  return runPipeline(
    buildRequest({
      query: "trending wallpaper",
      category: "all",
      page,
      mode: "featured"
    })
  );
}

// Daily wallpaper prefers NASA APOD but still guarantees a result if NASA is unavailable.
async function getDaily(): Promise<Wallpaper> {
  const cacheKey = generateCacheKey("daily", "space", 1, "daily");
  const cached = cacheGet(cacheKey);

  if (cached?.data[0]) {
    return decorateFavorites([cached.data[0]])[0] ?? cached.data[0];
  }

  const [wallpaper] = await runPipeline(
    buildRequest({
      query: "astronomy picture of the day",
      category: "space",
      page: 1,
      perPage: 1,
      mode: "daily"
    })
  );

  const fallbackDaily = createOfflineWallpapers(
    buildRequest({
      query: "astronomy picture of the day",
      category: "space",
      page: 1,
      perPage: 1,
      mode: "daily"
    })
  );
  const bundledDaily = searchBundledOfflineWallpapers({
    query: "astronomy picture of the day",
    category: "space",
    page: 1,
    perPage: 1
  });
  const result = wallpaper ?? bundledDaily[0] ?? fallbackDaily[0]!;

  cacheSet(cacheKey, [result], CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
  return result;
}

// Warm a small set of high-value categories so the app can start in a fast cache-first state.
// Warming cache is how the backend starts behaving more like a local content engine over time.
async function warmCache(categories = CACHE_SETTINGS.prefetchCategories): Promise<Record<string, number>> {
  const warmed: Record<string, number> = {};

  for (const category of categories) {
    const results = await getByCategory(category, 1);
    primeSearchBundleCache(results);
    warmed[category] = results.length;
  }

  return warmed;
}

// Lets the backend periodically prime high-value categories so first user requests are faster.
// Background warming is optional and host-controlled.
function startCacheWarmScheduler(
  intervalMs = 1000 * 60 * 60 * 6,
  categories = CACHE_SETTINGS.prefetchCategories
): { intervalMs: number; categories: string[] } {
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
function stopCacheWarmScheduler(): void {
  if (!cacheWarmTimer) {
    return;
  }

  clearInterval(cacheWarmTimer);
  cacheWarmTimer = null;
}

// This is the operator view of the system: source health plus cache state.
async function healthCheck(): Promise<EngineHealthReport> {
  const quota = getQuotaReport();
  const cache = cacheStats();
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
async function getStats(): Promise<EngineStats> {
  const quota = getQuotaReport();
  const cache = cacheStats();

  return {
    totalRequests,
    cacheHits: cache.hits + cache.staleHits,
    cacheMisses: cache.misses,
    avgResponseFresh: average(freshLatencies),
    avgResponseCached: average(cachedLatencies),
    apiUsage: {
      unsplash: quota.unsplash.totalRequests,
      pexels: quota.pexels.totalRequests,
      pixabay: quota.pixabay.totalRequests,
      nasa: quota.nasa.totalRequests,
      picsum: quota.picsum.totalRequests
    },
    errors: totalErrors,
    uptime: formatUptime(engineStartedAt)
  };
}

// The UI should only need this object, not the internals behind it.
// This exported object is the intended public backend surface.
export const engine = {
  getWallpapers,
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

export {
  getWallpapers,
  search,
  getFeatured,
  getTrending,
  getByCategory,
  getDaily,
  warmCache,
  startCacheWarmScheduler,
  stopCacheWarmScheduler,
  healthCheck,
  getStats,
  ENGINE_CONSTANTS
};
