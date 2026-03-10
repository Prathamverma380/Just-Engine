// This file answers the question:
// "Given this request, which source should we try first, and what should the fallback chain be?"
import {
  CATEGORY_KEYWORDS,
  CATEGORY_QUERIES,
  CATEGORY_SOURCE_PRIORITY,
  FEATURE_FLAGS
} from "../config";
import { hasQuota, isHealthy } from "../quota";
import type {
  ApiClientRequest,
  RemoteWallpaperSource,
  RoutingDecision,
  WallpaperCategory
} from "../types/wallpaper";

// This rotates "general" traffic so one provider does not get hammered unnecessarily.
// For generic traffic we rotate providers a bit so one source does not get all the load.
let rotationIndex = 0;

// If the caller does not provide a clean category, infer one from the query text.
// If the caller already gave us a specific category, trust it.
// Otherwise try to infer one from the search words.
export function resolveCategory(query: string, category?: string): string {
  const normalizedCategory = category?.trim().toLowerCase();
  if (normalizedCategory && normalizedCategory !== "all") {
    return normalizedCategory;
  }

  const normalizedQuery = query.toLowerCase();

  for (const [candidate, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedQuery.includes(keyword))) {
      return candidate;
    }
  }

  return "all";
}

// Round-robin is only used where the docs called for balanced general/trending traffic.
// Round-robin only matters for "all"/featured style traffic.
function rotateSources(sources: RemoteWallpaperSource[]): RemoteWallpaperSource[] {
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
export function getSourcePlan(request: ApiClientRequest): RemoteWallpaperSource[] {
  const category = resolveCategory(request.query, request.category);
  const fallbackPriority: RemoteWallpaperSource[] = ["unsplash", "pexels", "pixabay", "nasa"];
  let basePriority: RemoteWallpaperSource[];

  if (request.mode === "daily") {
    basePriority = ["nasa", "unsplash", "pexels", "pixabay"];
  } else {
    basePriority = CATEGORY_SOURCE_PRIORITY[category] ?? CATEGORY_SOURCE_PRIORITY.all ?? fallbackPriority;
  }

  const prioritized =
    category === "all" || request.mode === "featured" ? rotateSources(basePriority) : [...basePriority];

  const available = prioritized
    .filter((source) => source !== "picsum")
    .filter((source) => isHealthy(source) && hasQuota(source));

  return Array.from(new Set(available));
}

// Returns both the first choice and the reasoning behind it for debugging and operator visibility.
// Pick the first source, but also return the whole chain for debugging and fallback execution.
export function pickSource(request: ApiClientRequest): RoutingDecision {
  const category = resolveCategory(request.query, request.category);
  const chain = getSourcePlan({
    ...request,
    category
  });
  const source = chain[0] ?? "picsum";

  return {
    source,
    chain,
    reason:
      category === "all"
        ? "General request routed via round-robin priority and quota availability."
        : `Category "${category}" routed to highest-priority healthy source.`
  };
}

// The docs treat Picsum as the final live fallback after stale cache, not part of the main remote chain.
// There is only one "ultimate fallback" live source today, but keeping this as a function makes the policy explicit.
export function getUltimateFallbackSource(): RemoteWallpaperSource | null {
  return FEATURE_FLAGS.includePicsumFallback && isHealthy("picsum") && hasQuota("picsum") ? "picsum" : null;
}

// Category browsing still needs a concrete search phrase for provider APIs.
export function getDefaultQueryForCategory(category: string): string {
  return CATEGORY_QUERIES[(category as WallpaperCategory) ?? "all"] ?? `${category} wallpaper`;
}
