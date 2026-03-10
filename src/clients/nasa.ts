// NASA client: this one has two personalities.
// Search mode uses the NASA image library; daily mode uses APOD.
import { API_KEYS, REQUEST_DEFAULTS } from "../config";
import { fetchJson, retry, toQueryString } from "../utils";
import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";

// NASA search and APOD have different payload shapes, so both are modeled here.
// This shape is enough for image-library search results.
export interface NasaImageItem {
  data?: Array<{
    nasa_id?: string;
    title?: string;
    description?: string;
    keywords?: string[];
    photographer?: string;
    date_created?: string;
  }>;
  links?: Array<{
    href?: string;
  }>;
}

export interface NasaSearchResponse {
  collection?: {
    items?: NasaImageItem[];
  };
}

// This shape is enough for APOD.
export interface NasaApodResponse {
  date?: string;
  title?: string;
  explanation?: string;
  url?: string;
  hdurl?: string;
  media_type?: string;
  copyright?: string;
}

// NASA is special: normal search uses the image library, while daily mode uses APOD.
// The caller does not need to care which NASA endpoint was used.
// The client chooses based on request mode and returns raw data plus metadata.
export async function fetchNasa(
  request: ApiClientRequest
): Promise<ClientResponse<NasaSearchResponse | NasaApodResponse>> {
  const startedAt = Date.now();

  const url =
    request.mode === "daily"
      ? `https://api.nasa.gov/planetary/apod?${toQueryString({
          api_key: API_KEYS.nasa || "DEMO_KEY"
        })}`
      : `https://images-api.nasa.gov/search?${toQueryString({
          q: request.query,
          media_type: "image",
          page: request.page
        })}`;

  const data = await retry(
    () => fetchJson<NasaSearchResponse | NasaApodResponse>(url, {}, REQUEST_DEFAULTS.requestTimeoutMs),
    REQUEST_DEFAULTS.retryAttempts
  );

  return {
    source: "nasa",
    data,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    request
  };
}
