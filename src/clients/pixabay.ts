// Pixabay client: broad library, especially useful for illustrations and fallback volume.
import { API_KEYS, REQUEST_DEFAULTS } from "../config";
import { fetchJsonDetailed, retry, toQueryString } from "../utils";
import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";

// Pixabay is especially useful for illustrations, vectors, and wide-category fallback volume.
// Minimal Pixabay response typing.
export interface PixabayHit {
  id: number;
  webformatURL?: string;
  largeImageURL?: string;
  fullHDURL?: string;
  imageURL?: string;
  user?: string;
  userImageURL?: string;
  tags?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export interface PixabaySearchResponse {
  hits?: PixabayHit[];
}

// Pixabay uses query-string auth instead of headers, so this client keeps that detail isolated.
// Pixabay authenticates through query params, which is why this client looks slightly different from the others.
export async function fetchPixabay(
  request: ApiClientRequest
): Promise<ClientResponse<PixabaySearchResponse>> {
  const startedAt = Date.now();
  const query = toQueryString({
    key: API_KEYS.pixabay,
    q: request.query,
    page: request.page,
    per_page: request.perPage,
    image_type: "photo",
    orientation: "vertical",
    safesearch: true
  });
  const url = `https://pixabay.com/api/?${query}`;

  const result = await retry(
    () => fetchJsonDetailed<PixabaySearchResponse>(url, {}, REQUEST_DEFAULTS.requestTimeoutMs),
    REQUEST_DEFAULTS.retryAttempts
  );

  return {
    source: "pixabay",
    data: result.data,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    request,
    headers: result.headers,
    rateLimit: result.rateLimit
  };
}
