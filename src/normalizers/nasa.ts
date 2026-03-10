// NASA normalizer: branches between APOD and search because NASA gives us two very different payloads.
import { buildWallpaper, dedupeWallpapers, splitTags } from "../utils";
import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { NasaApodResponse, NasaSearchResponse } from "../clients/nasa";

// APOD and NASA search payloads differ enough that we need a runtime branch.
// Runtime discriminator for NASA's two response families.
function isApodResponse(value: NasaSearchResponse | NasaApodResponse): value is NasaApodResponse {
  return "media_type" in value || "hdurl" in value || "explanation" in value;
}

// Handles both the daily APOD path and the broader NASA image search path.
// APOD gives one hero image; search gives a collection.
// Both end up as the same `Wallpaper[]` shape here.
export function normalizeNasa(
  response: ClientResponse<NasaSearchResponse | NasaApodResponse>
): Wallpaper[] {
  if (isApodResponse(response.data)) {
    if (response.data.media_type && response.data.media_type !== "image") {
      return [];
    }

    return [
      buildWallpaper({
        source: "nasa",
        sourceId: response.data.date ?? "apod",
        urls: {
          thumbnail: response.data.url,
          preview: response.data.url,
          full: response.data.hdurl ?? response.data.url,
          original: response.data.hdurl ?? response.data.url
        },
        width: 2160,
        height: 3840,
        color: "#0b1120",
        description: response.data.title ?? response.data.explanation,
        tags: splitTags(["space", "nasa", "daily", response.request.query]),
        photographerName: response.data.copyright ?? "NASA",
        photographerUrl: "https://www.nasa.gov",
        category: "space",
        query: response.request.query,
        cachedAt: response.fetchedAt
      })
    ];
  }

  const items = response.data.collection?.items ?? [];

  return dedupeWallpapers(
    items.map((item, index) => {
      const primary = item.data?.[0];
      return buildWallpaper({
        source: "nasa",
        sourceId: primary?.nasa_id ?? `nasa_${index}`,
        urls: {
          thumbnail: item.links?.[0]?.href,
          preview: item.links?.[0]?.href,
          full: item.links?.[0]?.href,
          original: item.links?.[0]?.href
        },
        width: 2160,
        height: 3840,
        color: "#111827",
        description: primary?.title ?? primary?.description,
        tags: splitTags([...(primary?.keywords ?? []), response.request.query, "nasa"]),
        photographerName: primary?.photographer ?? "NASA",
        photographerUrl: "https://images.nasa.gov",
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
      });
    })
  );
}
