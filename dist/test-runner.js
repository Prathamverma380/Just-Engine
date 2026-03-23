"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// This file is not a unit test suite in the classic framework sense.
// It is a backend product verification script you can run directly in the terminal.
const cache_1 = require("./cache");
const clients_1 = require("./clients");
const engine_1 = require("./engine");
const ai_1 = require("./ai");
const normalizers_1 = require("./normalizers");
const bundle_1 = require("./offline/bundle");
const router_1 = require("./router");
const quota_1 = require("./quota");
const persistence_1 = require("./persistence");
const storage_1 = require("./storage");
const utils_1 = require("./utils");
const watermark_1 = require("./watermark");
// Keeps the output formatting readable.
function line(value = "") {
    console.log(value);
}
function pad(label, width = 22) {
    return `${label}${" ".repeat(Math.max(1, width - label.length))}`;
}
// PASS/FAIL helpers keep the console output uniform and easy to scan.
function pass(name, detail) {
    line(`  ${pad(name)}PASS  ${detail}`);
    return { name, passed: true, detail };
}
function fail(name, detail) {
    line(`  ${pad(name)}FAIL  ${detail}`);
    return { name, passed: false, detail };
}
function formatRateLimit(rateLimit) {
    if (!rateLimit || rateLimit.remaining === null || rateLimit.remaining === undefined) {
        return "remaining=header-unavailable";
    }
    return `remaining=${rateLimit.remaining}`;
}
// Measures end-to-end duration for higher-level engine calls.
async function measure(fn) {
    const startedAt = Date.now();
    const result = await fn();
    return {
        result,
        durationMs: Date.now() - startedAt
    };
}
// Quick sanity check that normalized wallpapers are usable, not just present.
function assertWallpapers(items, minimum = 1) {
    return (items.length >= minimum &&
        items.every((item) => Boolean(item.id && item.source) &&
            (0, utils_1.isValidUrl)(item.urls.thumbnail) &&
            (0, utils_1.isValidUrl)(item.urls.preview) &&
            (0, utils_1.isValidUrl)(item.urls.full) &&
            (0, utils_1.isValidUrl)(item.urls.original)));
}
// Verifies that every live source is reachable and returns data with the configured keys.
async function runApiClientTests() {
    line("[TEST 1] API Clients");
    const unsplashRequest = {
        query: "mountains",
        category: "nature",
        page: 1,
        perPage: 3,
        mode: "search"
    };
    const pexelsRequest = {
        query: "abstract wallpaper",
        category: "abstract",
        page: 1,
        perPage: 3,
        mode: "search"
    };
    const pixabayRequest = {
        query: "nature wallpaper",
        category: "nature",
        page: 1,
        perPage: 3,
        mode: "search"
    };
    const nasaRequest = {
        query: "nebula",
        category: "space",
        page: 1,
        perPage: 3,
        mode: "search"
    };
    const picsumRequest = {
        query: "wallpaper",
        category: "all",
        page: 1,
        perPage: 3,
        mode: "search"
    };
    const results = [];
    try {
        const unsplash = await (0, clients_1.fetchUnsplash)(unsplashRequest);
        results.push(unsplash.data.results?.length
            ? pass("Unsplash", `${unsplash.data.results.length} items, ${unsplash.latencyMs}ms, ${formatRateLimit(unsplash.rateLimit)}`)
            : fail("Unsplash", "no items returned"));
    }
    catch (error) {
        results.push(fail("Unsplash", error instanceof Error ? error.message : String(error)));
    }
    try {
        const pexels = await (0, clients_1.fetchPexels)(pexelsRequest);
        results.push(pexels.data.photos?.length
            ? pass("Pexels", `${pexels.data.photos.length} items, ${pexels.latencyMs}ms, ${formatRateLimit(pexels.rateLimit)}`)
            : fail("Pexels", "no items returned"));
    }
    catch (error) {
        results.push(fail("Pexels", error instanceof Error ? error.message : String(error)));
    }
    try {
        const pixabay = await (0, clients_1.fetchPixabay)(pixabayRequest);
        results.push(pixabay.data.hits?.length
            ? pass("Pixabay", `${pixabay.data.hits.length} items, ${pixabay.latencyMs}ms, ${formatRateLimit(pixabay.rateLimit)}`)
            : fail("Pixabay", "no items returned"));
    }
    catch (error) {
        results.push(fail("Pixabay", error instanceof Error ? error.message : String(error)));
    }
    try {
        const nasa = await (0, clients_1.fetchNasa)(nasaRequest);
        const count = "collection" in nasa.data ? nasa.data.collection?.items?.length ?? 0 : 1;
        results.push(count ? pass("NASA", `${count} items, ${nasa.latencyMs}ms, ${formatRateLimit(nasa.rateLimit)}`) : fail("NASA", "no items returned"));
    }
    catch (error) {
        results.push(fail("NASA", error instanceof Error ? error.message : String(error)));
    }
    try {
        const picsum = await (0, clients_1.fetchPicsum)(picsumRequest);
        results.push(picsum.data.length
            ? pass("Picsum", `${picsum.data.length} items, ${picsum.latencyMs}ms, ${formatRateLimit(picsum.rateLimit)}`)
            : fail("Picsum", "no items returned"));
    }
    catch (error) {
        results.push(fail("Picsum", error instanceof Error ? error.message : String(error)));
    }
    return results;
}
// Ensures raw provider payloads can all be converted into the same unified wallpaper shape.
async function runNormalizerTests() {
    line("[TEST 2] Normalizers");
    const results = [];
    try {
        const response = await (0, clients_1.fetchUnsplash)({
            query: "mountains",
            category: "nature",
            page: 1,
            perPage: 3,
            mode: "search"
        });
        const normalized = (0, normalizers_1.normalizeUnsplash)(response);
        results.push(assertWallpapers(normalized, 1)
            ? pass("Unsplash -> Wallpaper", `${normalized.length} normalized`)
            : fail("Unsplash -> Wallpaper", "invalid normalized output"));
    }
    catch (error) {
        results.push(fail("Unsplash -> Wallpaper", error instanceof Error ? error.message : String(error)));
    }
    try {
        const response = await (0, clients_1.fetchPexels)({
            query: "abstract wallpaper",
            category: "abstract",
            page: 1,
            perPage: 3,
            mode: "search"
        });
        const normalized = (0, normalizers_1.normalizePexels)(response);
        results.push(assertWallpapers(normalized, 1)
            ? pass("Pexels -> Wallpaper", `${normalized.length} normalized`)
            : fail("Pexels -> Wallpaper", "invalid normalized output"));
    }
    catch (error) {
        results.push(fail("Pexels -> Wallpaper", error instanceof Error ? error.message : String(error)));
    }
    try {
        const response = await (0, clients_1.fetchPixabay)({
            query: "illustration wallpaper",
            category: "illustration",
            page: 1,
            perPage: 3,
            mode: "search"
        });
        const normalized = (0, normalizers_1.normalizePixabay)(response);
        results.push(assertWallpapers(normalized, 1)
            ? pass("Pixabay -> Wallpaper", `${normalized.length} normalized`)
            : fail("Pixabay -> Wallpaper", "invalid normalized output"));
    }
    catch (error) {
        results.push(fail("Pixabay -> Wallpaper", error instanceof Error ? error.message : String(error)));
    }
    try {
        let response = await (0, clients_1.fetchNasa)({
            query: "astronomy picture of the day",
            category: "space",
            page: 1,
            perPage: 1,
            mode: "daily"
        });
        let detail = "daily";
        let normalized = (0, normalizers_1.normalizeNasa)(response);
        if (!assertWallpapers(normalized, 1)) {
            response = await (0, clients_1.fetchNasa)({
                query: "nebula",
                category: "space",
                page: 1,
                perPage: 3,
                mode: "search"
            });
            normalized = (0, normalizers_1.normalizeNasa)(response);
            detail = "search fallback";
        }
        results.push(assertWallpapers(normalized, 1)
            ? pass("NASA -> Wallpaper", `${normalized.length} normalized (${detail})`)
            : fail("NASA -> Wallpaper", "invalid normalized output"));
    }
    catch (error) {
        try {
            const response = await (0, clients_1.fetchNasa)({
                query: "nebula",
                category: "space",
                page: 1,
                perPage: 3,
                mode: "search"
            });
            const normalized = (0, normalizers_1.normalizeNasa)(response);
            results.push(assertWallpapers(normalized, 1)
                ? pass("NASA -> Wallpaper", `${normalized.length} normalized (search fallback)`)
                : fail("NASA -> Wallpaper", "invalid normalized output"));
        }
        catch (fallbackError) {
            const dailyError = error instanceof Error ? error.message : String(error);
            const searchError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            results.push(fail("NASA -> Wallpaper", `${dailyError} | fallback failed: ${searchError}`));
        }
    }
    try {
        const response = await (0, clients_1.fetchPicsum)({
            query: "wallpaper",
            category: "all",
            page: 1,
            perPage: 3,
            mode: "search"
        });
        const normalized = (0, normalizers_1.normalizePicsum)(response);
        results.push(assertWallpapers(normalized, 1)
            ? pass("Picsum -> Wallpaper", `${normalized.length} normalized`)
            : fail("Picsum -> Wallpaper", "invalid normalized output"));
    }
    catch (error) {
        results.push(fail("Picsum -> Wallpaper", error instanceof Error ? error.message : String(error)));
    }
    return results;
}
// Shows the routing logic the engine would use before any network request is made.
async function runRouterTests() {
    line("[TEST 3] Router");
    (0, quota_1.resetQuotaState)();
    const coldStartNature = (0, router_1.pickSource)({
        query: "mountains",
        category: "nature",
        page: 1,
        perPage: 5,
        mode: "search"
    });
    (0, quota_1.recordUsage)("unsplash", { success: true, latencyMs: 320 });
    (0, quota_1.recordUsage)("pexels", { success: true, latencyMs: 90 });
    (0, quota_1.recordUsage)("pixabay", { success: true, latencyMs: 210 });
    (0, quota_1.recordUsage)("nasa", { success: true, latencyMs: 450 });
    const nature = (0, router_1.pickSource)({
        query: "mountains",
        category: "nature",
        page: 1,
        perPage: 5,
        mode: "search"
    });
    const space = (0, router_1.pickSource)({
        query: "galaxy nebula",
        category: "space",
        page: 1,
        perPage: 5,
        mode: "search"
    });
    const general = (0, router_1.pickSource)({
        query: "wallpaper",
        category: "all",
        page: 1,
        perPage: 5,
        mode: "search"
    });
    const remotePlan = (0, router_1.getSourcePlan)({
        query: "mountains",
        category: "nature",
        page: 1,
        perPage: 5,
        mode: "search"
    });
    const ultimateFallback = (0, router_1.getUltimateFallbackSource)();
    const checks = [
        ["Cold-start priority routing", coldStartNature.source === "unsplash", coldStartNature.chain.join(" -> ")],
        ["Nature fastest routing", nature.source === "pexels", `${nature.chain.join(" -> ")} | ${nature.reason}`],
        ["Space fastest routing", space.source === "pexels", `${space.chain.join(" -> ")} | ${space.reason}`],
        ["General routing", general.chain.length > 0, general.chain.join(" -> ")],
        ["Remote chain excludes Picsum", !remotePlan.includes("picsum"), remotePlan.join(" -> ")],
        ["Ultimate fallback", ultimateFallback === "picsum", String(ultimateFallback)]
    ];
    return checks.map(([name, ok, detail]) => (ok ? pass(name, detail) : fail(name, detail)));
}
// Verifies that detailed prompts route into the AI generation path while simple prompts stay search-oriented.
async function runAiRoutingTests() {
    line("[TEST 3A] AI Routing");
    (0, cache_1.cacheClear)();
    const detailedPrompt = "create a cinematic neon samurai portrait with rim lighting 9:16 no text";
    let generationCalls = 0;
    (0, ai_1.setGenerateImageOverrideForTests)(async (request) => {
        generationCalls += 1;
        return {
            provider: "openai",
            model: request.model ?? "test-model",
            prompt: request.prompt,
            latencyMs: 5,
            images: [
                {
                    url: (0, utils_1.createSvgDataUrl)("AI Generated", "#111827", "#2563eb"),
                    width: 1024,
                    height: 1536,
                    revisedPrompt: request.prompt
                }
            ],
            route: {
                primary: "openai",
                chain: ["openai"],
                requestedProvider: request.provider ?? null,
                attempted: ["openai"],
                skipped: [],
                reason: "test override"
            },
            quota: null,
            persisted: false
        };
    });
    try {
        const simple = (0, ai_1.detectImageIntent)("mountains", "auto");
        const detailed = (0, ai_1.detectImageIntent)(detailedPrompt, "auto");
        const explicitSearch = (0, ai_1.detectImageIntent)(detailedPrompt, "search");
        const generated = await engine_1.engine.generate(detailedPrompt, {
            style: "cinematic",
            size: "1024x1536"
        });
        const cachedGenerated = await engine_1.engine.generate(detailedPrompt, {
            style: "cinematic",
            size: "1024x1536"
        });
        const autoGenerated = await engine_1.engine.getImages(detailedPrompt, {
            intent: "auto",
            style: "cinematic",
            size: "1024x1536"
        });
        const fallbackPrompt = "create mountains wallpaper cinematic 9:16 no text";
        const seededSearch = await engine_1.engine.search(fallbackPrompt, "nature", 1);
        (0, ai_1.setGenerateImageOverrideForTests)(async () => {
            throw new Error("Simulated AI outage");
        });
        const autoFallback = await engine_1.engine.getImages(fallbackPrompt, {
            intent: "auto",
            category: "nature",
            style: "cinematic",
            size: "1024x1536"
        });
        const checks = [
            ["Simple prompt stays search", simple.resolvedIntent === "search", JSON.stringify(simple)],
            ["Detailed prompt becomes generate", detailed.resolvedIntent === "generate", JSON.stringify(detailed)],
            ["Explicit search wins", explicitSearch.resolvedIntent === "search", JSON.stringify(explicitSearch)],
            ["Explicit AI generate", assertWallpapers(generated, 1) && generated[0]?.source === "ai", generated[0]?.source ?? "missing"],
            [
                "AI generate cache",
                generationCalls === 1 && cachedGenerated[0]?.id === generated[0]?.id,
                `calls=${generationCalls}, ids=${generated[0]?.id} :: ${cachedGenerated[0]?.id}`
            ],
            ["Auto routes to AI", autoGenerated[0]?.source === "ai", autoGenerated[0]?.source ?? "missing"],
            [
                "Auto AI failure falls back to search",
                assertWallpapers(autoFallback, 1) &&
                    autoFallback[0]?.source !== "ai" &&
                    autoFallback[0]?.id === seededSearch[0]?.id,
                `${autoFallback[0]?.source ?? "missing"} :: ${autoFallback[0]?.id ?? "missing"}`
            ]
        ];
        return checks.map(([name, ok, detail]) => (ok ? pass(name, detail) : fail(name, detail)));
    }
    finally {
        (0, ai_1.setGenerateImageOverrideForTests)(null);
    }
}
// Verifies the real wrapper request shape stays compatible with OpenAI's image API.
// This uses a mocked fetch so we can inspect the outgoing body without making a live billable request.
async function runAiWrapperRequestShapeTests() {
    line("[TEST 3B] AI Wrapper Request");
    const originalFetch = globalThis.fetch;
    const capturedCalls = [];
    globalThis.fetch = (async (url, init) => {
        const requestUrl = typeof url === "string"
            ? url
            : url instanceof URL
                ? url.toString()
                : "url" in url && typeof url.url === "string"
                    ? url.url
                    : "";
        const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        capturedCalls.push({
            url: requestUrl,
            body: parsedBody
        });
        return new Response(JSON.stringify({
            data: [
                {
                    url: (0, utils_1.createSvgDataUrl)("AI Generated", "#111827", "#2563eb"),
                    revised_prompt: "wrapped prompt"
                }
            ]
        }), {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        });
    });
    try {
        const generated = await engine_1.engine.generate("minimal mountain wallpaper", {
            size: "1024x1536",
            quality: "high",
            style: "vivid"
        });
        const openAiRequest = capturedCalls.find((call) => {
            const body = call.body;
            return Boolean(body &&
                typeof body["prompt"] === "string" &&
                typeof body["model"] === "string" &&
                !("request_payload" in body) &&
                call.url.includes("/images/generations"));
        });
        const requestBody = openAiRequest?.body ?? null;
        const bodyStyle = requestBody ? requestBody["style"] : undefined;
        const bodyPrompt = requestBody ? requestBody["prompt"] : undefined;
        const promptText = typeof bodyPrompt === "string" ? bodyPrompt : "";
        const checks = [
            [
                "No unsupported style field",
                bodyStyle === undefined,
                JSON.stringify(requestBody ?? {})
            ],
            [
                "Style folded into prompt",
                promptText.includes("Style preference: vivid"),
                promptText
            ],
            [
                "Wrapper still returns wallpaper",
                assertWallpapers(generated, 1) && generated[0]?.source === "ai",
                generated[0]?.source ?? "missing"
            ]
        ];
        return checks.map(([name, ok, detail]) => (ok ? pass(name, detail) : fail(name, detail)));
    }
    finally {
        globalThis.fetch = originalFetch;
    }
}
// Proves the cache can write and immediately serve the same request back.
async function runCacheTests() {
    line("[TEST 4] Cache");
    (0, cache_1.cacheClear)();
    (0, cache_1.localBundleClear)();
    const key = (0, cache_1.generateCacheKey)("mountains", "nature", 1);
    const sample = await engine_1.engine.search("mountains", "nature", 1);
    (0, cache_1.cacheSet)(key, sample);
    const readFresh = (0, cache_1.cacheGet)(key);
    const readAgain = (0, cache_1.cacheGet)(key);
    const staleKey = (0, cache_1.generateCacheKey)("stale", "nature", 1);
    (0, cache_1.cacheSet)(staleKey, sample, -1, 60_000);
    const staleMiss = (0, cache_1.cacheGet)(staleKey);
    const staleRead = (0, cache_1.cacheGet)(staleKey, {
        allowStale: true
    });
    const persistedKey = (0, cache_1.generateCacheKey)("persisted", "nature", 1);
    (0, cache_1.cacheSet)(persistedKey, sample);
    (0, cache_1.cacheResetMemory)();
    const persistedRead = (0, cache_1.cacheGet)(persistedKey);
    const persistencePath = (0, persistence_1.getPersistencePath)();
    const dataRoot = (0, persistence_1.getDataRootPath)();
    (0, cache_1.cacheClear)();
    (0, cache_1.cacheResetMemory)();
    const quotaBefore = (0, quota_1.getQuotaReport)();
    const localBundleResults = (0, cache_1.localBundleSearch)("mountains", "nature", 1, 15);
    const localServed = await engine_1.engine.search("mountains", "nature", 1);
    const quotaAfter = (0, quota_1.getQuotaReport)();
    const usedRemoteApis = quotaAfter.unsplash.totalRequests !== quotaBefore.unsplash.totalRequests ||
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
        persistencePath && dataRoot && persistencePath.startsWith(dataRoot)
            ? pass("Persistence path", persistencePath)
            : fail("Persistence path", `${dataRoot} :: ${persistencePath}`),
        localBundleResults.length > 0
            ? pass("Local bundle search", `${localBundleResults.length} local matches`)
            : fail("Local bundle search", "no local bundle matches"),
        localServed.length > 0 && !usedRemoteApis
            ? pass("Local DB before APIs", "search served without new API calls")
            : fail("Local DB before APIs", `remote usage changed=${usedRemoteApis}`)
    ];
}
// Confirms favorites, preferences, downloads, and search history persist through the storage API.
async function runStorageTests() {
    line("[TEST 5] Storage");
    (0, storage_1.storageClear)();
    const [sample] = await engine_1.engine.search("mountains", "nature", 1);
    if (!sample) {
        return [fail("Storage setup", "no sample wallpaper returned")];
    }
    (0, storage_1.saveFavorite)(sample);
    (0, storage_1.savePreference)("theme", "dark");
    (0, storage_1.addToDownloadHistory)(sample);
    (0, storage_1.addSearchHistory)("mountains");
    (0, storage_1.setSubscriptionState)("premium");
    const firstLaunch = (0, storage_1.consumeFirstLaunch)();
    const secondLaunch = (0, storage_1.consumeFirstLaunch)();
    return [
        (0, storage_1.isFavorite)(sample.id) ? pass("Favorite save", sample.id) : fail("Favorite save", "favorite not persisted"),
        (0, storage_1.getFavorites)().length > 0 ? pass("Favorite read", `${(0, storage_1.getFavorites)().length} favorites`) : fail("Favorite read", "favorites missing"),
        (0, storage_1.getPreference)("theme") === "dark"
            ? pass("Preference save", "theme=dark")
            : fail("Preference save", "preference missing"),
        (0, storage_1.getDownloadHistory)().length > 0
            ? pass("Download history", `${(0, storage_1.getDownloadHistory)().length} records`)
            : fail("Download history", "download missing"),
        (0, storage_1.getSearchHistory)().includes("mountains")
            ? pass("Search history", (0, storage_1.getSearchHistory)().join(", "))
            : fail("Search history", "query missing"),
        (0, storage_1.getSubscriptionState)() === "premium"
            ? pass("Subscription state", "premium")
            : fail("Subscription state", (0, storage_1.getSubscriptionState)()),
        firstLaunch && !secondLaunch
            ? pass("First launch flag", "true once, then false")
            : fail("First launch flag", `${firstLaunch} -> ${secondLaunch}`)
    ];
}
// Covers the utility layer that sits between raw wallpapers and host-platform actions.
async function runUtilityTests() {
    line("[TEST 6] Utilities");
    const [sample] = await engine_1.engine.search("mountains", "nature", 1);
    if (!sample) {
        return [fail("Utility setup", "no sample wallpaper returned")];
    }
    const previewUrl = (0, utils_1.getWallpaperUrl)(sample, "preview");
    const adaptiveUrl = (0, utils_1.getBestWallpaperUrl)(sample, 1440, 2560);
    const sharePayload = (0, utils_1.buildSharePayload)(sample);
    const thumbnailPath = await (0, utils_1.cacheWallpaperThumbnail)(sample);
    const cachedThumbnailPath = (0, utils_1.getCachedThumbnailPath)(sample);
    const bundlePaths = await (0, utils_1.cacheWallpaperBundle)(sample);
    const dataRoot = (0, persistence_1.getDataRootPath)();
    const watermarkSourceUrl = (0, utils_1.createSvgDataUrl)("Watermark Test", "#0f172a", "#2563eb");
    const watermarkSample = (0, utils_1.buildWallpaper)({
        source: "local",
        sourceId: "watermark-test",
        urls: {
            thumbnail: watermarkSourceUrl,
            preview: watermarkSourceUrl,
            full: watermarkSourceUrl,
            original: watermarkSourceUrl
        },
        width: 1200,
        height: 2200,
        description: "Watermark utility sample",
        tags: ["watermark", "test"],
        photographerName: "Just Engine",
        photographerUrl: "",
        category: "abstract",
        query: "watermark utility sample"
    });
    const watermarkedPreviewUrl = await (0, watermark_1.getDeliveredWallpaperUrl)(watermarkSample, "preview", {
        tier: "free"
    });
    const watermarkedWallpaper = await (0, watermark_1.prepareWallpaperForDelivery)(watermarkSample, {
        tier: "free",
        variants: ["thumbnail", "preview"]
    });
    const watermarkCachePath = (0, watermark_1.getCachedWatermarkPath)(watermarkSample, "preview", {
        tier: "free"
    });
    const premiumThumbnailPath = await (0, utils_1.cacheWallpaperThumbnail)(watermarkSample);
    const freeThumbnailPath = await (0, utils_1.cacheWallpaperThumbnail)(watermarkSample, {
        deliveryTier: "free"
    });
    const freeBundlePaths = await (0, utils_1.cacheWallpaperBundle)(watermarkSample, {
        deliveryTier: "free"
    });
    const bundledOffline = (0, bundle_1.searchBundledOfflineWallpapers)({
        query: "nebula",
        category: "space",
        page: 1,
        perPage: 3
    });
    const scheduler = engine_1.engine.startCacheWarmScheduler(60_000, ["nature"]);
    engine_1.engine.stopCacheWarmScheduler();
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
        dataRoot !== null && bundlePaths.previewPath.startsWith(dataRoot) && thumbnailPath.startsWith(dataRoot)
            ? pass("Search bundle path", JSON.stringify(bundlePaths))
            : fail("Search bundle path", JSON.stringify(bundlePaths)),
        watermarkedPreviewUrl.startsWith("data:image/svg+xml")
            ? pass("Watermarked delivery url", "svg watermark generated")
            : fail("Watermarked delivery url", watermarkedPreviewUrl.slice(0, 60)),
        Boolean(watermarkedWallpaper.delivery?.isWatermarked) &&
            watermarkedWallpaper.delivery?.tier === "free" &&
            Boolean(watermarkedWallpaper.delivery?.transformedVariants.includes("preview"))
            ? pass("Watermarked wallpaper metadata", JSON.stringify(watermarkedWallpaper.delivery))
            : fail("Watermarked wallpaper metadata", JSON.stringify(watermarkedWallpaper.delivery)),
        Boolean(watermarkCachePath && watermarkCachePath.includes("watermarks"))
            ? pass("Watermark cache path", watermarkCachePath ?? "")
            : fail("Watermark cache path", watermarkCachePath ?? "missing"),
        premiumThumbnailPath !== freeThumbnailPath &&
            freeThumbnailPath.includes("free") &&
            premiumThumbnailPath.includes("thumbnails")
            ? pass("Tiered thumbnail cache", `${premiumThumbnailPath} | ${freeThumbnailPath}`)
            : fail("Tiered thumbnail cache", `${premiumThumbnailPath} | ${freeThumbnailPath}`),
        freeBundlePaths.previewPath.includes("free")
            ? pass("Tiered bundle cache", freeBundlePaths.previewPath)
            : fail("Tiered bundle cache", freeBundlePaths.previewPath),
        bundledOffline.length > 0 && assertWallpapers(bundledOffline, 1)
            ? pass("Offline bundle", `${bundledOffline.length} bundled matches`)
            : fail("Offline bundle", "no bundled matches"),
        scheduler.intervalMs === 60_000 && scheduler.categories.includes("nature")
            ? pass("Warm scheduler", JSON.stringify(scheduler))
            : fail("Warm scheduler", JSON.stringify(scheduler))
    ];
}
// Exercises the real top-level engine methods the future UI will call.
async function runPipelineTests() {
    line("[TEST 7] Full Pipeline");
    const first = await measure(() => engine_1.engine.search("mountains", "nature", 1));
    const alias = await measure(() => engine_1.engine.getWallpapers("mountains", "nature", 1));
    const second = await measure(() => engine_1.engine.search("mountains", "nature", 1));
    const featured = await measure(() => engine_1.engine.getFeatured());
    const trending = await measure(() => engine_1.engine.getTrending());
    const daily = await measure(() => engine_1.engine.getDaily());
    const warmed = await measure(() => engine_1.engine.warmCache(["nature", "space"]));
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
async function runStressTests() {
    line("[TEST 8] Stress");
    const queries = [
        ["mountains", "nature"],
        ["nebula", "space"],
        ["minimal wallpaper", "minimal"],
        ["abstract art", "abstract"],
        ["night city", "city"]
    ];
    const startedAt = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => {
        const pair = queries[index % queries.length] ?? queries[0];
        const [query, category] = pair;
        return engine_1.engine.search(query, category, 1);
    }));
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
async function runStatsTests() {
    line("[TEST 9] Health + Stats");
    const health = await engine_1.engine.healthCheck();
    const stats = await engine_1.engine.getStats();
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
async function main() {
    line("===============================================");
    line("WALLPAPER ENGINE BACKEND TEST RUNNER");
    line("===============================================");
    const groups = [];
    groups.push(await runApiClientTests());
    groups.push(await runNormalizerTests());
    groups.push(await runRouterTests());
    groups.push(await runAiRoutingTests());
    groups.push(await runAiWrapperRequestShapeTests());
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
