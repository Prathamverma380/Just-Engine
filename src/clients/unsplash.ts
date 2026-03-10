import { API_KEYS, REQUEST_DEFAULTS } from "../config";
import { fetchJson, retry, toQueryString } from "../utils";
import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";

// Only the fields we actually use are typed here to keep the client lean.
export interface UnsplashPhoto {
  id: string;
  width?: number;
  height?: number;
  color?: string;
  description?: string | null;
  alt_description?: string | null;
  blur_hash?: string | null;
  urls?: {
    raw?: string;
    full?: string;
    regular?: string;
    small?: string;
    thumb?: string;
  };
  user?: {
    name?: string;
    links?: {
      html?: string;
    };
    profile_image?: {
      small?: string;
    };
  };
  tags?: Array<{
    title?: string;
  }>;
}

export interface UnsplashSearchResponse {
  results?: UnsplashPhoto[];
}

// Unsplash is our preferred source for nature and high-quality photography.
export async function fetchUnsplash(
  request: ApiClientRequest
): Promise<ClientResponse<UnsplashSearchResponse>> {
  const startedAt = Date.now();
  const query = toQueryString({
    query: request.query,
    page: request.page,
    per_page: request.perPage,
    orientation: "portrait"
  });
  const url = `https://api.unsplash.com/search/photos?${query}`;

  const data = await retry(
    () =>
      fetchJson<UnsplashSearchResponse>(
        url,
        {
          headers: {
            Authorization: `Client-ID ${API_KEYS.unsplash}`
          }
        },
        REQUEST_DEFAULTS.requestTimeoutMs
      ),
    REQUEST_DEFAULTS.retryAttempts
  );

  return {
    source: "unsplash",
    data,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    request
  };
}
