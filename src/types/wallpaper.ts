// These constants define the full vocabulary of sources and categories the engine understands.
export const WALLPAPER_SOURCES = [
  "unsplash",
  "pexels",
  "pixabay",
  "nasa",
  "picsum",
  "local"
] as const;

export const REMOTE_WALLPAPER_SOURCES = [
  "unsplash",
  "pexels",
  "pixabay",
  "nasa",
  "picsum"
] as const;

export const WALLPAPER_CATEGORIES = [
  "all",
  "nature",
  "abstract",
  "space",
  "dark",
  "minimal",
  "city",
  "animals",
  "illustration",
  "gradient",
  "seasonal"
] as const;

// A wallpaper can come from a live provider or from our local offline fallback bundle.
export type WallpaperSource = (typeof WALLPAPER_SOURCES)[number];
// Remote sources are the ones that go through the client -> normalizer pipeline.
export type RemoteWallpaperSource = (typeof REMOTE_WALLPAPER_SOURCES)[number];
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];
export type RequestMode = "search" | "featured" | "daily" | "category";
export type WallpaperVariant = "thumbnail" | "preview" | "full" | "original";

// The UI should never care which provider we used.
// It only needs a consistent set of URLs for list, preview, and download states.
export interface WallpaperUrls {
  thumbnail: string;
  preview: string;
  full: string;
  original: string;
}

// This keeps the descriptive side of the image in one place:
// size, color, placeholder, text, and searchable tags.
export interface WallpaperMetadata {
  width: number;
  height: number;
  color: string;
  blurHash: string;
  description: string;
  tags: string[];
}

// Every image should carry attribution, even if a provider gives us only partial author data.
export interface Photographer {
  name: string;
  url: string;
  avatar?: string;
}

// This is the single source of truth for the whole project.
// Every raw provider response gets normalized into this exact shape.
export interface Wallpaper {
  id: string;
  source: WallpaperSource;
  sourceId: string;
  urls: WallpaperUrls;
  metadata: WallpaperMetadata;
  photographer: Photographer;
  category: string;
  isFavorite: boolean;
  downloadedAt: number | null;
  cachedAt: number;
}

// This is the public request shape before the engine sanitizes it.
export interface SearchQuery {
  query: string;
  category?: string;
  page?: number;
  perPage?: number;
  mode?: RequestMode;
}

// This is the fully prepared request shape that internal clients actually consume.
export interface ApiClientRequest {
  query: string;
  category: string;
  page: number;
  perPage: number;
  mode: RequestMode;
}

// Each client returns raw provider data plus timing and request context.
export interface ClientResponse<T = unknown> {
  source: RemoteWallpaperSource;
  data: T;
  fetchedAt: number;
  latencyMs: number;
  request: ApiClientRequest;
}

// Cache entries keep both freshness and stale-fallback windows.
export interface CacheEntry<T> {
  key: string;
  data: T;
  createdAt: number;
  expiresAt: number;
  staleAt: number;
  lastAccessedAt: number;
}

// Reads from cache tell us whether we served fresh or stale data.
export interface CacheLookupResult<T> {
  data: T;
  state: "fresh" | "stale";
}

// Limits are intentionally flexible because each provider uses a different quota model.
export interface QuotaLimits {
  minute?: number;
  hourly?: number;
  monthly?: number;
  reserveRatio: number;
  requiresKey: boolean;
}

// This snapshot is what health and stats screens can render without touching internal state.
export interface SourceQuotaSnapshot {
  source: WallpaperSource;
  healthy: boolean;
  configured: boolean;
  remaining: number | "infinite";
  latency: number | null;
  minuteRemaining?: number | "infinite";
  hourlyRemaining?: number | "infinite";
  monthlyRemaining?: number | "infinite";
  totalRequests: number;
  failures: number;
}

// The router explains both the source it picked and the fallback chain behind that decision.
export interface RoutingDecision {
  source: RemoteWallpaperSource;
  reason: string;
  chain: RemoteWallpaperSource[];
}

// Cache stats are lightweight but enough to understand whether the engine is getting faster over time.
export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  staleHits: number;
  writes: number;
  hitRate: number;
  oldestEntry: number | null;
}

// Health is the operator-facing view of the backend.
export interface EngineHealthReport {
  unsplash: SourceQuotaSnapshot;
  pexels: SourceQuotaSnapshot;
  pixabay: SourceQuotaSnapshot;
  nasa: SourceQuotaSnapshot;
  picsum: SourceQuotaSnapshot;
  cache: CacheStats;
  overall: string;
}

// Stats are the product-facing summary of usage and performance.
export interface EngineStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  avgResponseFresh: number;
  avgResponseCached: number;
  apiUsage: Record<RemoteWallpaperSource, number>;
  errors: number;
  uptime: string;
}

export interface DownloadResult {
  filePath: string;
  bytesWritten: number;
  contentType: string;
}

export interface SharePayload {
  title: string;
  text: string;
  url: string;
}
