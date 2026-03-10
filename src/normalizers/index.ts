// After client selection, the engine uses this map to choose the matching raw->unified conversion function.
import { normalizeNasa } from "./nasa";
import { normalizePexels } from "./pexels";
import { normalizePicsum } from "./picsum";
import { normalizePixabay } from "./pixabay";
import { normalizeUnsplash } from "./unsplash";
import type { ClientResponse, RemoteWallpaperSource, Wallpaper } from "../types/wallpaper";

// All normalizers end up looking identical from the engine's point of view.
export type SourceNormalizer = (response: ClientResponse<any>) => Wallpaper[];

// Central registry parallel to the clients map.
export const normalizers: Record<RemoteWallpaperSource, SourceNormalizer> = {
  unsplash: (response) => normalizeUnsplash(response),
  pexels: (response) => normalizePexels(response),
  pixabay: (response) => normalizePixabay(response),
  nasa: (response) => normalizeNasa(response),
  picsum: (response) => normalizePicsum(response)
};

// Lets the engine select a normalizer dynamically after it selects a source.
export function getNormalizer(source: RemoteWallpaperSource): SourceNormalizer {
  return normalizers[source];
}

export { normalizeUnsplash, normalizePexels, normalizePixabay, normalizeNasa, normalizePicsum };
