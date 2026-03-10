// Pexels normalizer: turn Pexels photo payloads into the engine's one true wallpaper shape.
import { buildWallpaper, dedupeWallpapers, splitTags } from "../utils";
import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PexelsSearchResponse } from "../clients/pexels";

// Maps Pexels image sizes and attribution into our unified contract.
// Most of the work here is just choosing the right Pexels image sizes and attribution fields.
export function normalizePexels(response: ClientResponse<PexelsSearchResponse>): Wallpaper[] {
  const items = response.data.photos ?? [];

  return dedupeWallpapers(
    items.map((item) =>
      buildWallpaper({
        source: "pexels",
        sourceId: String(item.id),
        urls: {
          thumbnail: item.src?.tiny ?? item.src?.small,
          preview: item.src?.medium ?? item.src?.large,
          full: item.src?.large2x ?? item.src?.portrait ?? item.src?.large,
          original: item.src?.original
        },
        width: item.width,
        height: item.height,
        color: item.avg_color,
        description: item.alt ?? undefined,
        tags: splitTags([response.request.category, response.request.query, item.alt ?? ""]),
        photographerName: item.photographer,
        photographerUrl: item.photographer_url,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
      })
    )
  );
}
