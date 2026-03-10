import { buildWallpaper, dedupeWallpapers, splitTags } from "../utils";
import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { UnsplashSearchResponse } from "../clients/unsplash";

// Converts Unsplash-specific fields into the engine's single wallpaper shape.
export function normalizeUnsplash(response: ClientResponse<UnsplashSearchResponse>): Wallpaper[] {
  const items = response.data.results ?? [];

  return dedupeWallpapers(
    items.map((item) =>
      buildWallpaper({
        source: "unsplash",
        sourceId: item.id,
        urls: {
          thumbnail: item.urls?.thumb,
          preview: item.urls?.regular,
          full: item.urls?.full,
          original: item.urls?.raw
        },
        width: item.width,
        height: item.height,
        color: item.color,
        blurHash: item.blur_hash ?? "",
        description: item.description ?? item.alt_description ?? undefined,
        tags: [
          ...splitTags(item.tags?.map((tag) => tag.title ?? "")),
          ...splitTags(response.request.query)
        ],
        photographerName: item.user?.name,
        photographerUrl: item.user?.links?.html,
        photographerAvatar: item.user?.profile_image?.small,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
      })
    )
  );
}
