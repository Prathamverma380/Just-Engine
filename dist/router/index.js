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
    return Array.from(new Set(available));
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
    return {
        source,
        chain,
        reason: category === "all"
            ? "General request routed via round-robin priority and quota availability."
            : `Category "${category}" routed to highest-priority healthy source.`
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
