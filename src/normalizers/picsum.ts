// Picsum normalizer: mostly just manufactures the size variants the engine expects.
import { buildWallpaper, dedupeWallpapers, splitTags } from "../utils";
import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PicsumListResponse } from "../clients/picsum";

// Picsum gives us simple image metadata, so normalization here is mostly URL shaping.
// Even the simplest source gets normalized so the engine can stay API-agnostic.
export function normalizePicsum(response: ClientResponse<PicsumListResponse>): Wallpaper[] {
  const items = response.data ?? [];

  return dedupeWallpapers(
    items.map((item) =>
      buildWallpaper({
        source: "picsum",
        sourceId: item.id,
        urls: {
          thumbnail: `https://picsum.photos/id/${item.id}/320/568`,
          preview: `https://picsum.photos/id/${item.id}/900/1600`,
          full: `https://picsum.photos/id/${item.id}/1440/2560`,
          original:
            item.download_url ??
            `https://picsum.photos/id/${item.id}/${Math.max(1, item.width ?? 1440)}/${Math.max(1, item.height ?? 2560)}`
        },
        width: item.width,
        height: item.height,
        color: "#374151",
        description: `${item.author ?? "Picsum"} wallpaper`,
        tags: splitTags([response.request.category, response.request.query, "picsum"]),
        photographerName: item.author,
        photographerUrl: item.url,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
      })
    )
  );
}
