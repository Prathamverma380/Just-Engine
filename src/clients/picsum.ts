// Picsum client: simple, unlimited, and intentionally boring.
// It exists so the engine has a live fallback even when every quota-based source is unavailable.
import { REQUEST_DEFAULTS } from "../config";
import { fetchJsonDetailed, retry, toQueryString } from "../utils";
import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";

// Picsum is intentionally simple and acts as our always-available live fallback.
export interface PicsumPhoto {
  id: string;
  author?: string;
  width?: number;
  height?: number;
  url?: string;
  download_url?: string;
}

export type PicsumListResponse = PicsumPhoto[];

// This client is our unlimited safety net when premium sources fail or are skipped.
// Returns a page of generic images from Picsum.
export async function fetchPicsum(
  request: ApiClientRequest
): Promise<ClientResponse<PicsumListResponse>> {
  const startedAt = Date.now();
  const url = `https://picsum.photos/v2/list?${toQueryString({
    page: request.page,
    limit: request.perPage
  })}`;

  const result = await retry(
    () => fetchJsonDetailed<PicsumListResponse>(url, {}, REQUEST_DEFAULTS.requestTimeoutMs),
    REQUEST_DEFAULTS.retryAttempts
  );

  return {
    source: "picsum",
    data: result.data,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    request,
    headers: result.headers,
    rateLimit: result.rateLimit
  };
}
