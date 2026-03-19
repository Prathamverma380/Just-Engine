"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCategory = resolveCategory;
exports.getSourcePlan = getSourcePlan;
exports.pickSource = pickSource;
exports.getUltimateFallbackSource = getUltimateFallbackSource;
exports.getDefaultQueryForCategory = getDefaultQueryForCategory;
// This file answers the question:
// "Given this request, which source should we try first, and what should the fallback chain be?"
const config_1 = require("../config");
const quota_1 = require("../quota");
// This rotates "general" traffic so one provider does not get hammered unnecessarily.
// For generic traffic we rotate providers a bit so one source does not get all the load.
// This prevents rate-limit issues by distributing requests across providers.
let rotationIndex = 0;
// If the caller does not provide a clean category, infer one from the query text.
// If the caller already gave us a specific category, trust it.
// Otherwise try to infer one from the search words.
function resolveCategory(query, category) {
    const normalizedCategory = category?.trim().toLowerCase();
    if (normalizedCategory && normalizedCategory !== "all") {
        return normalizedCategory;
    }
    const normalizedQuery = query.toLowerCase();
    for (const [candidate, keywords] of Object.entries(config_1.CATEGORY_KEYWORDS)) {
        if (keywords.some((keyword) => normalizedQuery.includes(keyword))) {
            return candidate;
        }
    }
    return "all";
}
// Round-robin is only used where the docs called for balanced general/trending traffic.
// Round-robin only matters for "all"/featured style traffic.
function rotateSources(sources) {
    if (sources.length <= 1) {
        return sources;
    }
    const offset = rotationIndex % sources.length;
    rotationIndex += 1;
    return [...sources.slice(offset), ...sources.slice(0, offset)];
}
function rankSourcesByLatency(sources, basePriority) {
    const priorityIndex = new Map(basePriority.map((source, index) => [source, index]));
    return [...sources].sort((left, right) => {
        const leftLatency = (0, quota_1.getLastLatency)(left);
        const rightLatency = (0, quota_1.getLastLatency)(right);
        if (leftLatency !== null && rightLatency !== null && leftLatency !== rightLatency) {
            return leftLatency - rightLatency;
        }
        if (leftLatency !== null && rightLatency === null) {
            return -1;
        }
        if (leftLatency === null && rightLatency !== null) {
            return 1;
        }
        return (priorityIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (priorityIndex.get(right) ?? Number.MAX_SAFE_INTEGER);
    });
}
// Builds the fallback chain the engine should try for a given request.
// Builds the remote source chain only.
// Picsum is kept out of the main chain now because the docs wanted stale cache before the final live fallback.
function getSourcePlan(request) {
    const category = resolveCategory(request.query, request.category);
    const fallbackPriority = ["unsplash", "pexels", "pixabay", "nasa"];
    let basePriority;
    if (request.mode === "daily") {
        basePriority = ["nasa", "unsplash", "pexels", "pixabay"];
    }
    else {
        basePriority = config_1.CATEGORY_SOURCE_PRIORITY[category] ?? config_1.CATEGORY_SOURCE_PRIORITY.all ?? fallbackPriority;
    }
    const prioritized = category === "all" || request.mode === "featured" ? rotateSources(basePriority) : [...basePriority];
    const available = prioritized
        .filter((source) => source !== "picsum")
        .filter((source) => (0, quota_1.isHealthy)(source) && (0, quota_1.hasQuota)(source));
    return Array.from(new Set(rankSourcesByLatency(available, prioritized)));
}
// Returns both the first choice and the reasoning behind it for debugging and operator visibility.
// Pick the first source, but also return the whole chain for debugging and fallback execution.
function pickSource(request) {
    const category = resolveCategory(request.query, request.category);
    const chain = getSourcePlan({
        ...request,
        category
    });
    const source = chain[0] ?? "picsum";
    const latency = chain[0] ? (0, quota_1.getLastLatency)(chain[0]) : null;
    const routingMode = category === "all" ? "general" : `category "${category}"`;
    const reason = chain.length
        ? latency !== null
            ? `${routingMode} routed to fastest healthy source with quota available (${source}, last latency ${latency}ms).`
            : `${routingMode} routed by priority because no live latency data was available.`
        : "No healthy quota-backed remote sources were available; using fallback strategy.";
    return {
        source,
        chain,
        reason
    };
}
// The docs treat Picsum as the final live fallback after stale cache, not part of the main remote chain.
// There is only one "ultimate fallback" live source today, but keeping this as a function makes the policy explicit.
function getUltimateFallbackSource() {
    return config_1.FEATURE_FLAGS.includePicsumFallback && (0, quota_1.isHealthy)("picsum") && (0, quota_1.hasQuota)("picsum") ? "picsum" : null;
}
// Category browsing still needs a concrete search phrase for provider APIs.
function getDefaultQueryForCategory(category) {
    return config_1.CATEGORY_QUERIES[category ?? "all"] ?? `${category} wallpaper`;
}
