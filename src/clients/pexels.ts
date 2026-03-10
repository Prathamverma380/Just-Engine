// Pexels client: header-auth search against curated commercial-free photography.
import { API_KEYS, REQUEST_DEFAULTS } from "../config";
import { fetchJson, retry, toQueryString } from "../utils";
import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";

// Narrow client-side view of the Pexels payload.
// Minimal Pexels payload typing: only what the normalizer actually needs.
export interface PexelsPhoto {
  id: number;
  width?: number;
  height?: number;
  avg_color?: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
    small?: string;
    portrait?: string;
    tiny?: string;
  };
}

export interface PexelsSearchResponse {
  photos?: PexelsPhoto[];
}

// Pexels is strong for abstract, minimal, and general curated photography searches.
// Calls Pexels and returns raw provider data plus timing/context for the rest of the engine.
export async function fetchPexels(
  request: ApiClientRequest
): Promise<ClientResponse<PexelsSearchResponse>> {
  const startedAt = Date.now();
  const query = toQueryString({
    query: request.query,
    page: request.page,
    per_page: request.perPage,
    orientation: "portrait"
  });
  const url = `https://api.pexels.com/v1/search?${query}`;

  const data = await retry(
    () =>
      fetchJson<PexelsSearchResponse>(
        url,
        {
          headers: {
            Authorization: API_KEYS.pexels
          }
        },
        REQUEST_DEFAULTS.requestTimeoutMs
      ),
    REQUEST_DEFAULTS.retryAttempts
  );

  return {
    source: "pexels",
    data,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    request
  };
}
