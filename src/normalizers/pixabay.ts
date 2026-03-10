// Pixabay normalizer: especially useful because Pixabay tags come in as CSV strings.
import { buildWallpaper, dedupeWallpapers, splitTags } from "../utils";
import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PixabaySearchResponse } from "../clients/pixabay";

// Converts Pixabay's image fields and comma-separated tags into a clean wallpaper list.
// Converts Pixabay's field names into the same wallpaper object used everywhere else.
export function normalizePixabay(response: ClientResponse<PixabaySearchResponse>): Wallpaper[] {
  const items = response.data.hits ?? [];

  return dedupeWallpapers(
    items.map((item) =>
      buildWallpaper({
        source: "pixabay",
        sourceId: String(item.id),
        urls: {
          thumbnail: item.webformatURL,
          preview: item.largeImageURL ?? item.webformatURL,
          full: item.fullHDURL ?? item.largeImageURL,
          original: item.imageURL ?? item.fullHDURL ?? item.largeImageURL
        },
        width: item.imageWidth,
        height: item.imageHeight,
        description: item.tags,
        tags: splitTags(item.tags),
        photographerName: item.user,
        photographerUrl: "",
        photographerAvatar: item.userImageURL,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
      })
    )
  );
}
