// This registry is how the engine avoids `switch(source)` everywhere.
import { fetchNasa } from "./nasa";
import { fetchPexels } from "./pexels";
import { fetchPicsum } from "./picsum";
import { fetchPixabay } from "./pixabay";
import { fetchUnsplash } from "./unsplash";
import type { ApiClientRequest, ClientResponse, RemoteWallpaperSource } from "../types/wallpaper";

// All source clients share the same callable shape once requests are sanitized.
export type SourceClient = (request: ApiClientRequest) => Promise<ClientResponse>;

// Central registry so the engine can look clients up dynamically.
export const clients: Record<RemoteWallpaperSource, SourceClient> = {
  unsplash: fetchUnsplash,
  pexels: fetchPexels,
  pixabay: fetchPixabay,
  nasa: fetchNasa,
  picsum: fetchPicsum
};

// Keeps the engine clean and avoids switch statements when selecting a provider client.
export function getClient(source: RemoteWallpaperSource): SourceClient {
  return clients[source];
}

export { fetchUnsplash, fetchPexels, fetchPixabay, fetchNasa, fetchPicsum };
