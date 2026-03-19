// This is the heart of the product.
// Every UI or script should ideally talk only to this file.
import { detectImageIntent, generateImage } from "../ai";
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
  AI_SETTINGS,
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
  buildWallpaper,
  cacheWallpaperBundle,
  clamp,
  createOfflineWallpapers,
  dedupeWallpapers,
  formatUptime,
  getDayOfYear,
  hashString,
  normalizeQuery
} from "../utils";
import type { AiGenerationRequest, AiGenerationResponse } from "../ai";

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

// These runtime metrics back `getStats()` and help explain engine behavior over time.
const engineStartedAt = Date.now();
const freshLatencies: number[] = [];
const cachedLatencies: number[] = [];
let totalRequests = 0;
let totalErrors = 0;
let cacheWarmTimer: ReturnType<typeof setInterval> | null = null;

function shouldSuppressHandledSourceLogs(): boolean {
  const value = process?.env?.WALLPAPER_ENGINE_SUPPRESS_FALLBACK_ERRORS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logHandledSourceFailure(label: string, error: unknown): void {
  if (shouldSuppressHandledSourceLogs()) {
    return;
  }

  console.warn(`[engine] ${label} failed: ${formatErrorMessage(error)}`);
}

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

type ImageRequestOptions = Omit<SearchQuery, "query">;

// Builds the public request object used by both the normal search path and the AI path.
// Keeping this in one place prevents the two entry points from drifting apart over time.
function buildImageQuery(query: string, options: ImageRequestOptions = {}, intent = AI_SETTINGS.defaultIntent): SearchQuery {
  const payload: SearchQuery = {
    query,
    page: options.page ?? 1,
    mode: options.mode ?? "search",
    intent
  };

  if (options.category !== undefined) {
    payload.category = options.category;
  }

  if (options.perPage !== undefined) {
    payload.perPage = options.perPage;
  }

  if (options.model !== undefined) {
    payload.model = options.model;
  }

  if (options.size !== undefined) {
    payload.size = options.size;
  }

  if (options.quality !== undefined) {
    payload.quality = options.quality;
  }

  if (options.style !== undefined) {
    payload.style = options.style;
  }

  if (options.negativePrompt !== undefined) {
    payload.negativePrompt = options.negativePrompt;
  }

  return payload;
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

// Converts the public request shape into the stricter AI wrapper request shape.
// This is where we resolve category, apply AI defaults, and cap the number of generated images.
function buildAiRequest(input: SearchQuery): AiGenerationRequest {
  const request: AiGenerationRequest = {
    prompt: input.query.trim(),
    category: resolveCategory(input.query, input.category),
    model: input.model?.trim() || AI_SETTINGS.defaultModel,
    size: input.size?.trim() || AI_SETTINGS.defaultSize,
    quality: input.quality?.trim() || AI_SETTINGS.defaultQuality,
    style: input.style?.trim() || AI_SETTINGS.defaultStyle,
    count: Math.min(Math.max(1, input.perPage ?? 1), AI_SETTINGS.maxImagesPerRequest)
  };

  if (input.negativePrompt?.trim()) {
    request.negativePrompt = input.negativePrompt.trim();
  }

  return request;
}

// Generated-image cache keys must stay separate from search-result cache keys,
// otherwise the same prompt could collide between "search" and "generate" modes.
function generateAiCacheKey(request: AiGenerationRequest): string {
  const signature = [
    request.prompt.trim().toLowerCase(),
    request.category.trim().toLowerCase(),
    request.model?.trim().toLowerCase() || AI_SETTINGS.defaultModel,
    request.size?.trim().toLowerCase() || AI_SETTINGS.defaultSize,
    request.quality?.trim().toLowerCase() || AI_SETTINGS.defaultQuality,
    request.style?.trim().toLowerCase() || AI_SETTINGS.defaultStyle,
    request.negativePrompt?.trim().toLowerCase() || "",
    String(request.count ?? 1)
  ].join("::");

  return `generate:${hashString(signature)}`;
}

// The AI wrapper returns raw generated image details; this maps them into the shared Wallpaper shape
// so favorites, downloads, and the rest of the app can treat generated images like any other result.
function buildGeneratedWallpapers(response: AiGenerationResponse, request: AiGenerationRequest): Wallpaper[] {
  return response.images.slice(0, request.count ?? 1).map((image, index) =>
    buildWallpaper({
      source: "ai",
      sourceId: `${hashString(`${response.provider}:${response.model}:${request.prompt}:${index}`)}_${index}`,
      urls: {
        thumbnail: image.url,
        preview: image.url,
        full: image.url,
        original: image.url
      },
      width: image.width,
      height: image.height,
      description: image.revisedPrompt ?? request.prompt,
      tags: [request.category, request.style, "ai", "generated", response.provider, response.model].filter(
        (value): value is string => Boolean(value)
      ),
      photographerName: "AI Wrapper",
      photographerUrl: "",
      category: request.category,
      query: request.prompt
    })
  );
}

// The generation pipeline mirrors the normal request pipeline, but intentionally skips the local bundle.
// For now we only exact-request-cache generated images; we are not deciding long-term storage here yet.
async function runGenerationPipeline(request: AiGenerationRequest): Promise<Wallpaper[]> {
  totalRequests += 1;
  const startedAt = Date.now();
  const cacheKey = generateAiCacheKey(request);
  const cached = cacheGet(cacheKey);

  if (cached) {
    cachedLatencies.push(Math.max(1, Date.now() - startedAt));
    return decorateFavorites(cached.data);
  }

  const response = await generateImage(request);
  const wallpapers = buildGeneratedWallpapers(response, request);

  if (wallpapers.length === 0) {
    throw new Error("AI generation produced no wallpapers.");
  }

  cacheSet(cacheKey, wallpapers, CACHE_SETTINGS.ttlMs, CACHE_SETTINGS.staleTtlMs);
  freshLatencies.push(Math.max(1, Date.now() - startedAt));
  return decorateFavorites(wallpapers);
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
      logHandledSourceFailure(`Source ${source}`, error);
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
      logHandledSourceFailure(`Ultimate fallback ${ultimateFallbackSource}`, error);
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
  const options: ImageRequestOptions = {
    page
  };

  if (category !== undefined) {
    options.category = category;
  }

  return runPipeline(
    buildRequest(
      buildImageQuery(query, options, "search")
    )
  );
}

// Explicit generation never touches the search-provider router.
async function generate(prompt: string, options: ImageRequestOptions = {}): Promise<Wallpaper[]> {
  return runGenerationPipeline(
    buildAiRequest(buildImageQuery(prompt, options, "generate"))
  );
}

// `getImages` is the auto-aware public entry point:
// detailed prompt -> AI generation
// normal query -> existing provider search
async function getImages(query: string, options: ImageRequestOptions = {}): Promise<Wallpaper[]> {
  const payload = buildImageQuery(query, options, options.intent ?? AI_SETTINGS.defaultIntent);
  const intentDetection = detectImageIntent(payload.query, payload.intent ?? AI_SETTINGS.defaultIntent);

  if (intentDetection.resolvedIntent === "generate" && FEATURE_FLAGS.enableAiGeneration) {
    try {
      return runGenerationPipeline(buildAiRequest(payload));
    } catch (error) {
      if ((payload.intent ?? AI_SETTINGS.defaultIntent) === "generate") {
        throw error;
      }

      logHandledSourceFailure("AI generation", error);
    }
  }

  const searchOptions: ImageRequestOptions = {};
  if (payload.category !== undefined) {
    searchOptions.category = payload.category;
  }
  if (payload.page !== undefined) {
    searchOptions.page = payload.page;
  }
  if (payload.perPage !== undefined) {
    searchOptions.perPage = payload.perPage;
  }
  if (payload.mode !== undefined) {
    searchOptions.mode = payload.mode;
  }

  return runPipeline(
    buildRequest(
      buildImageQuery(payload.query, searchOptions, "search")
    )
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
  getImages,
  search,
  generate,
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
  getImages,
  search,
  generate,
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
