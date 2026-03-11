// This file is not a unit test suite in the classic framework sense.
// It is a backend product verification script you can run directly in the terminal.
import {
  cacheClear,
  cacheGet,
  cacheResetMemory,
  cacheSet,
  generateCacheKey,
  localBundleClear,
  localBundleSearch
} from "./cache";
import { fetchNasa, fetchPexels, fetchPicsum, fetchPixabay, fetchUnsplash } from "./clients";
import { engine } from "./engine";
import {
  normalizeNasa,
  normalizePexels,
  normalizePicsum,
  normalizePixabay,
  normalizeUnsplash
} from "./normalizers";
import { searchBundledOfflineWallpapers } from "./offline/bundle";
import { getSourcePlan, getUltimateFallbackSource, pickSource } from "./router";
import { getQuotaReport } from "./quota";
import { getDataRootPath, getPersistencePath } from "./persistence";
import {
  addSearchHistory,
  addToDownloadHistory,
  consumeFirstLaunch,
  getDownloadHistory,
  getFavorites,
  getPreference,
  getSearchHistory,
  getSubscriptionState,
  isFavorite,
  saveFavorite,
  savePreference,
  setSubscriptionState,
  storageClear
} from "./storage";
import type { ApiClientRequest, Wallpaper } from "./types/wallpaper";
import {
  buildSharePayload,
  cacheWallpaperBundle,
  cacheWallpaperThumbnail,
  getBestWallpaperUrl,
  getCachedThumbnailPath,
  getWallpaperUrl,
  isValidUrl
} from "./utils";

declare const process:
  | {
      exit: (code?: number) => never;
    }
  | undefined;

// Tiny shape used to summarize each individual check in the console output.
type TestResult = {
  name: string;
  passed: boolean;
  detail: string;
};

// Keeps the output formatting readable.
function line(value = ""): void {
  console.log(value);
}

function pad(label: string, width = 22): string {
  return `${label}${" ".repeat(Math.max(1, width - label.length))}`;
}

// PASS/FAIL helpers keep the console output uniform and easy to scan.
function pass(name: string, detail: string): TestResult {
  line(`  ${pad(name)}PASS  ${detail}`);
  return { name, passed: true, detail };
}

function fail(name: string, detail: string): TestResult {
  line(`  ${pad(name)}FAIL  ${detail}`);
  return { name, passed: false, detail };
}

function formatRateLimit(rateLimit: { remaining: number | "infinite" | null } | null): string {
  if (!rateLimit || rateLimit.remaining === null || rateLimit.remaining === undefined) {
    return "remaining=header-unavailable";
  }

  return `remaining=${rateLimit.remaining}`;
}

// Measures end-to-end duration for higher-level engine calls.
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const startedAt = Date.now();
  const result = await fn();
  return {
    result,
    durationMs: Date.now() - startedAt
  };
}

// Quick sanity check that normalized wallpapers are usable, not just present.
function assertWallpapers(items: Wallpaper[], minimum = 1): boolean {
  return (
    items.length >= minimum &&
    items.every(
      (item) =>
        Boolean(item.id && item.source) &&
        isValidUrl(item.urls.thumbnail) &&
        isValidUrl(item.urls.preview) &&
        isValidUrl(item.urls.full) &&
        isValidUrl(item.urls.original)
    )
  );
}

// Verifies that every live source is reachable and returns data with the configured keys.
async function runApiClientTests(): Promise<TestResult[]> {
  line("[TEST 1] API Clients");

  const unsplashRequest: ApiClientRequest = {
    query: "mountains",
    category: "nature",
    page: 1,
    perPage: 3,
    mode: "search"
  };
  const pexelsRequest: ApiClientRequest = {
    query: "abstract wallpaper",
    category: "abstract",
    page: 1,
    perPage: 3,
    mode: "search"
  };
  const pixabayRequest: ApiClientRequest = {
    query: "nature wallpaper",
    category: "nature",
    page: 1,
    perPage: 3,
    mode: "search"
  };
  const nasaRequest: ApiClientRequest = {
    query: "nebula",
    category: "space",
    page: 1,
    perPage: 3,
    mode: "search"
  };
  const picsumRequest: ApiClientRequest = {
    query: "wallpaper",
    category: "all",
    page: 1,
    perPage: 3,
    mode: "search"
  };

  const results: TestResult[] = [];

  try {
    const unsplash = await fetchUnsplash(unsplashRequest);
    results.push(
      unsplash.data.results?.length
        ? pass("Unsplash", `${unsplash.data.results.length} items, ${unsplash.latencyMs}ms, ${formatRateLimit(unsplash.rateLimit)}`)
        : fail("Unsplash", "no items returned")
    );
  } catch (error) {
    results.push(fail("Unsplash", error instanceof Error ? error.message : String(error)));
  }

  try {
    const pexels = await fetchPexels(pexelsRequest);
    results.push(
      pexels.data.photos?.length
        ? pass("Pexels", `${pexels.data.photos.length} items, ${pexels.latencyMs}ms, ${formatRateLimit(pexels.rateLimit)}`)
        : fail("Pexels", "no items returned")
    );
  } catch (error) {
    results.push(fail("Pexels", error instanceof Error ? error.message : String(error)));
  }

  try {
    const pixabay = await fetchPixabay(pixabayRequest);
    results.push(
      pixabay.data.hits?.length
        ? pass("Pixabay", `${pixabay.data.hits.length} items, ${pixabay.latencyMs}ms, ${formatRateLimit(pixabay.rateLimit)}`)
        : fail("Pixabay", "no items returned")
    );
  } catch (error) {
    results.push(fail("Pixabay", error instanceof Error ? error.message : String(error)));
  }

  try {
    const nasa = await fetchNasa(nasaRequest);
    const count = "collection" in nasa.data ? nasa.data.collection?.items?.length ?? 0 : 1;
    results.push(
      count ? pass("NASA", `${count} items, ${nasa.latencyMs}ms, ${formatRateLimit(nasa.rateLimit)}`) : fail("NASA", "no items returned")
    );
  } catch (error) {
    results.push(fail("NASA", error instanceof Error ? error.message : String(error)));
  }

  try {
    const picsum = await fetchPicsum(picsumRequest);
    results.push(
      picsum.data.length
        ? pass("Picsum", `${picsum.data.length} items, ${picsum.latencyMs}ms, ${formatRateLimit(picsum.rateLimit)}`)
        : fail("Picsum", "no items returned")
    );
  } catch (error) {
    results.push(fail("Picsum", error instanceof Error ? error.message : String(error)));
  }

  return results;
}

// Ensures raw provider payloads can all be converted into the same unified wallpaper shape.
async function runNormalizerTests(): Promise<TestResult[]> {
  line("[TEST 2] Normalizers");

  const results: TestResult[] = [];

  try {
    const response = await fetchUnsplash({
      query: "mountains",
      category: "nature",
      page: 1,
      perPage: 3,
      mode: "search"
    });
    const normalized = normalizeUnsplash(response);
    results.push(
      assertWallpapers(normalized, 1)
        ? pass("Unsplash -> Wallpaper", `${normalized.length} normalized`)
        : fail("Unsplash -> Wallpaper", "invalid normalized output")
    );
  } catch (error) {
    results.push(fail("Unsplash -> Wallpaper", error instanceof Error ? error.message : String(error)));
  }

  try {
    const response = await fetchPexels({
      query: "abstract wallpaper",
      category: "abstract",
      page: 1,
      perPage: 3,
      mode: "search"
    });
    const normalized = normalizePexels(response);
    results.push(
      assertWallpapers(normalized, 1)
        ? pass("Pexels -> Wallpaper", `${normalized.length} normalized`)
        : fail("Pexels -> Wallpaper", "invalid normalized output")
    );
  } catch (error) {
    results.push(fail("Pexels -> Wallpaper", error instanceof Error ? error.message : String(error)));
  }

  try {
    const response = await fetchPixabay({
      query: "illustration wallpaper",
      category: "illustration",
      page: 1,
      perPage: 3,
      mode: "search"
    });
    const normalized = normalizePixabay(response);
    results.push(
      assertWallpapers(normalized, 1)
        ? pass("Pixabay -> Wallpaper", `${normalized.length} normalized`)
        : fail("Pixabay -> Wallpaper", "invalid normalized output")
    );
  } catch (error) {
    results.push(fail("Pixabay -> Wallpaper", error instanceof Error ? error.message : String(error)));
  }

  try {
    const response = await fetchNasa({
      query: "astronomy picture of the day",
      category: "space",
      page: 1,
      perPage: 1,
      mode: "daily"
    });
    const normalized = normalizeNasa(response);
    results.push(
      assertWallpapers(normalized, 1)
        ? pass("NASA -> Wallpaper", `${normalized.length} normalized`)
        : fail("NASA -> Wallpaper", "invalid normalized output")
    );
  } catch (error) {
    results.push(fail("NASA -> Wallpaper", error instanceof Error ? error.message : String(error)));
  }

  try {
    const response = await fetchPicsum({
      query: "wallpaper",
      category: "all",
      page: 1,
      perPage: 3,
      mode: "search"
    });
    const normalized = normalizePicsum(response);
    results.push(
      assertWallpapers(normalized, 1)
        ? pass("Picsum -> Wallpaper", `${normalized.length} normalized`)
        : fail("Picsum -> Wallpaper", "invalid normalized output")
    );
  } catch (error) {
    results.push(fail("Picsum -> Wallpaper", error instanceof Error ? error.message : String(error)));
  }

  return results;
}

// Shows the routing logic the engine would use before any network request is made.
async function runRouterTests(): Promise<TestResult[]> {
  line("[TEST 3] Router");

  const nature = pickSource({
    query: "mountains",
    category: "nature",
    page: 1,
    perPage: 5,
    mode: "search"
  });
  const space = pickSource({
    query: "galaxy nebula",
    category: "space",
    page: 1,
    perPage: 5,
    mode: "search"
  });
  const general = pickSource({
    query: "wallpaper",
    category: "all",
    page: 1,
    perPage: 5,
    mode: "search"
  });
  const remotePlan = getSourcePlan({
    query: "mountains",
    category: "nature",
    page: 1,
    perPage: 5,
    mode: "search"
  });
  const ultimateFallback = getUltimateFallbackSource();

  const checks: Array<[string, boolean, string]> = [
    ["Nature routing", nature.source === "unsplash" || nature.chain.includes("unsplash"), nature.chain.join(" -> ")],
    ["Space routing", space.source === "nasa" || space.chain.includes("nasa"), space.chain.join(" -> ")],
    ["General routing", general.chain.length > 0, general.chain.join(" -> ")],
    ["Remote chain excludes Picsum", !remotePlan.includes("picsum"), remotePlan.join(" -> ")],
    ["Ultimate fallback", ultimateFallback === "picsum", String(ultimateFallback)]
  ];

  return checks.map(([name, ok, detail]) => (ok ? pass(name, detail) : fail(name, detail)));
}

// Proves the cache can write and immediately serve the same request back.
async function runCacheTests(): Promise<TestResult[]> {
  line("[TEST 4] Cache");
  cacheClear();
  localBundleClear();

  const key = generateCacheKey("mountains", "nature", 1);
  const sample = await engine.search("mountains", "nature", 1);
  cacheSet(key, sample);
  const readFresh = cacheGet(key);
  const readAgain = cacheGet(key);
  const staleKey = generateCacheKey("stale", "nature", 1);
  cacheSet(staleKey, sample, -1, 60_000);
  const staleMiss = cacheGet(staleKey);
  const staleRead = cacheGet(staleKey, {
    allowStale: true
  });
  const persistedKey = generateCacheKey("persisted", "nature", 1);
  cacheSet(persistedKey, sample);
  cacheResetMemory();
  const persistedRead = cacheGet(persistedKey);
  const persistencePath = getPersistencePath();
  cacheClear();
  cacheResetMemory();
  const quotaBefore = getQuotaReport();
  const localBundleResults = localBundleSearch("mountains", "nature", 1, 15);
  const localServed = await engine.search("mountains", "nature", 1);
  const quotaAfter = getQuotaReport();
  const usedRemoteApis =
    quotaAfter.unsplash.totalRequests !== quotaBefore.unsplash.totalRequests ||
    quotaAfter.pexels.totalRequests !== quotaBefore.pexels.totalRequests ||
    quotaAfter.pixabay.totalRequests !== quotaBefore.pixabay.totalRequests ||
    quotaAfter.nasa.totalRequests !== quotaBefore.nasa.totalRequests ||
    quotaAfter.picsum.totalRequests !== quotaBefore.picsum.totalRequests;

  return [
    sample.length > 0 ? pass("Cache write", `${sample.length} items stored`) : fail("Cache write", "no items to store"),
    readFresh ? pass("Cache read", `${readFresh.state} hit`) : fail("Cache read", "cache miss"),
    readAgain ? pass("Cache repeat read", `${readAgain.state} hit`) : fail("Cache repeat read", "cache miss"),
    !staleMiss ? pass("Fresh TTL expiry", "expired entry hidden from normal reads") : fail("Fresh TTL expiry", "expired entry still visible"),
    staleRead?.state === "stale"
      ? pass("Stale fallback read", "stale entry returned when explicitly allowed")
      : fail("Stale fallback read", "stale entry not returned"),
    persistedRead?.state === "fresh"
      ? pass("Disk cache reload", "cache survived memory reset")
      : fail("Disk cache reload", "cache did not survive memory reset"),
    persistencePath?.includes("db 0.4")
      ? pass("External cache root", persistencePath)
      : fail("External cache root", String(persistencePath)),
    localBundleResults.length > 0
      ? pass("Local bundle search", `${localBundleResults.length} local matches`)
      : fail("Local bundle search", "no local bundle matches"),
    localServed.length > 0 && !usedRemoteApis
      ? pass("Local DB before APIs", "search served without new API calls")
      : fail("Local DB before APIs", `remote usage changed=${usedRemoteApis}`)
  ];
}

// Confirms favorites, preferences, downloads, and search history persist through the storage API.
async function runStorageTests(): Promise<TestResult[]> {
  line("[TEST 5] Storage");
  storageClear();

  const [sample] = await engine.search("mountains", "nature", 1);
  if (!sample) {
    return [fail("Storage setup", "no sample wallpaper returned")];
  }

  saveFavorite(sample);
  savePreference("theme", "dark");
  addToDownloadHistory(sample);
  addSearchHistory("mountains");
  setSubscriptionState("premium");
  const firstLaunch = consumeFirstLaunch();
  const secondLaunch = consumeFirstLaunch();

  return [
    isFavorite(sample.id) ? pass("Favorite save", sample.id) : fail("Favorite save", "favorite not persisted"),
    getFavorites().length > 0 ? pass("Favorite read", `${getFavorites().length} favorites`) : fail("Favorite read", "favorites missing"),
    getPreference<string>("theme") === "dark"
      ? pass("Preference save", "theme=dark")
      : fail("Preference save", "preference missing"),
    getDownloadHistory().length > 0
      ? pass("Download history", `${getDownloadHistory().length} records`)
      : fail("Download history", "download missing"),
    getSearchHistory().includes("mountains")
      ? pass("Search history", getSearchHistory().join(", "))
      : fail("Search history", "query missing"),
    getSubscriptionState() === "premium"
      ? pass("Subscription state", "premium")
      : fail("Subscription state", getSubscriptionState()),
    firstLaunch && !secondLaunch
      ? pass("First launch flag", "true once, then false")
      : fail("First launch flag", `${firstLaunch} -> ${secondLaunch}`)
  ];
}

// Covers the utility layer that sits between raw wallpapers and host-platform actions.
async function runUtilityTests(): Promise<TestResult[]> {
  line("[TEST 6] Utilities");

  const [sample] = await engine.search("mountains", "nature", 1);
  if (!sample) {
    return [fail("Utility setup", "no sample wallpaper returned")];
  }

  const previewUrl = getWallpaperUrl(sample, "preview");
  const adaptiveUrl = getBestWallpaperUrl(sample, 1440, 2560);
  const sharePayload = buildSharePayload(sample);
  const thumbnailPath = await cacheWallpaperThumbnail(sample);
  const cachedThumbnailPath = getCachedThumbnailPath(sample);
  const bundlePaths = await cacheWallpaperBundle(sample);
  const dataRoot = getDataRootPath();
  const bundledOffline = searchBundledOfflineWallpapers({
    query: "nebula",
    category: "space",
    page: 1,
    perPage: 3
  });
  const scheduler = engine.startCacheWarmScheduler(60_000, ["nature"]);
  engine.stopCacheWarmScheduler();

  return [
    previewUrl === sample.urls.preview
      ? pass("Variant URL", previewUrl.slice(0, 60))
      : fail("Variant URL", "preview URL mismatch"),
    adaptiveUrl.length > 0
      ? pass("Adaptive URL", adaptiveUrl.slice(0, 60))
      : fail("Adaptive URL", "adaptive URL missing"),
    sharePayload.url === sample.urls.original && sharePayload.text.length > 0
      ? pass("Share payload", sharePayload.text)
      : fail("Share payload", "invalid share payload"),
    thumbnailPath.length > 0 && cachedThumbnailPath === thumbnailPath
      ? pass("Thumbnail cache", thumbnailPath)
      : fail("Thumbnail cache", String(cachedThumbnailPath)),
    bundlePaths.previewPath.includes("db 0.4") && dataRoot?.includes("db 0.4")
      ? pass("Search bundle path", JSON.stringify(bundlePaths))
      : fail("Search bundle path", JSON.stringify(bundlePaths)),
    bundledOffline.length > 0 && assertWallpapers(bundledOffline, 1)
      ? pass("Offline bundle", `${bundledOffline.length} bundled matches`)
      : fail("Offline bundle", "no bundled matches"),
    scheduler.intervalMs === 60_000 && scheduler.categories.includes("nature")
      ? pass("Warm scheduler", JSON.stringify(scheduler))
      : fail("Warm scheduler", JSON.stringify(scheduler))
  ];
}

// Exercises the real top-level engine methods the future UI will call.
async function runPipelineTests(): Promise<TestResult[]> {
  line("[TEST 7] Full Pipeline");

  const first = await measure(() => engine.search("mountains", "nature", 1));
  const alias = await measure(() => engine.getWallpapers("mountains", "nature", 1));
  const second = await measure(() => engine.search("mountains", "nature", 1));
  const featured = await measure(() => engine.getFeatured());
  const trending = await measure(() => engine.getTrending());
  const daily = await measure(() => engine.getDaily());
  const warmed = await measure(() => engine.warmCache(["nature", "space"]));

  return [
    assertWallpapers(first.result, 1)
      ? pass("Search fresh", `${first.result.length} results, ${first.durationMs}ms`)
      : fail("Search fresh", "invalid result set"),
    assertWallpapers(alias.result, 1)
      ? pass("getWallpapers alias", `${alias.result.length} results, ${alias.durationMs}ms`)
      : fail("getWallpapers alias", "invalid alias result set"),
    assertWallpapers(second.result, 1)
      ? pass("Search cached", `${second.result.length} results, ${second.durationMs}ms`)
      : fail("Search cached", "invalid result set"),
    assertWallpapers(featured.result, 1)
      ? pass("Featured", `${featured.result.length} results, ${featured.durationMs}ms`)
      : fail("Featured", "invalid result set"),
    assertWallpapers(trending.result, 1)
      ? pass("Trending", `${trending.result.length} results, ${trending.durationMs}ms`)
      : fail("Trending", "invalid result set"),
    daily.result?.id
      ? pass("Daily", `${daily.result.source} daily wallpaper, ${daily.durationMs}ms`)
      : fail("Daily", "daily wallpaper missing"),
    Object.values(warmed.result).every((count) => count > 0)
      ? pass("Warm cache", `${JSON.stringify(warmed.result)}, ${warmed.durationMs}ms`)
      : fail("Warm cache", JSON.stringify(warmed.result))
  ];
}

// Gives us a basic confidence check that repeated engine usage stays stable and fast enough.
async function runStressTests(): Promise<TestResult[]> {
  line("[TEST 8] Stress");

  const queries: Array<[string, string]> = [
    ["mountains", "nature"],
    ["nebula", "space"],
    ["minimal wallpaper", "minimal"],
    ["abstract art", "abstract"],
    ["night city", "city"]
  ];

  const startedAt = Date.now();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => {
      const pair = queries[index % queries.length] ?? queries[0]!;
      const [query, category] = pair;
      return engine.search(query, category, 1);
    })
  );
  const durationMs = Date.now() - startedAt;
  const totalItems = results.reduce((sum, items) => sum + items.length, 0);
  const allValid = results.every((items) => assertWallpapers(items, 1));

  return [
    allValid
      ? pass("Burst requests", `${results.length} requests, ${totalItems} wallpapers, ${durationMs}ms`)
      : fail("Burst requests", "one or more request results were invalid")
  ];
}

// Wraps up with the operator-facing health and stats views.
async function runStatsTests(): Promise<TestResult[]> {
  line("[TEST 9] Health + Stats");

  const health = await engine.healthCheck();
  const stats = await engine.getStats();

  return [
    health.overall.includes("OPERATIONAL")
      ? pass("Health", `${health.overall}, cache size ${health.cache.size}`)
      : fail("Health", health.overall),
    stats.totalRequests > 0
      ? pass("Stats", `${stats.totalRequests} requests, cache hits ${stats.cacheHits}`)
      : fail("Stats", "no stats recorded")
  ];
}

// Runs the whole suite sequentially so the terminal output stays readable.
async function main(): Promise<void> {
  line("===============================================");
  line("WALLPAPER ENGINE BACKEND TEST RUNNER");
  line("===============================================");

  const groups = [];
  groups.push(await runApiClientTests());
  groups.push(await runNormalizerTests());
  groups.push(await runRouterTests());
  groups.push(await runCacheTests());
  groups.push(await runStorageTests());
  groups.push(await runUtilityTests());
  groups.push(await runPipelineTests());
  groups.push(await runStressTests());
  groups.push(await runStatsTests());

  const results = groups.flat();
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  line("===============================================");
  line(`TOTAL: ${passed}/${results.length} passed`);
  line(`FAILED: ${failed}`);

  if (failed > 0) {
    line("STATUS: FAILED");
    if (process) {
      process.exit(1);
    }
    return;
  }

  line("STATUS: PASSED");
}

main().catch((error) => {
  console.error("Test runner crashed:", error);
  if (process) {
    process.exit(1);
  }
});
