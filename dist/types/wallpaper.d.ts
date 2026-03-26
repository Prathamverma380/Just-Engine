export declare const WALLPAPER_SOURCES: readonly ["unsplash", "pexels", "pixabay", "nasa", "picsum", "ai", "local"];
export declare const REMOTE_WALLPAPER_SOURCES: readonly ["unsplash", "pexels", "pixabay", "nasa", "picsum"];
export declare const WALLPAPER_CATEGORIES: readonly ["all", "nature", "abstract", "space", "dark", "minimal", "city", "animals", "illustration", "gradient", "seasonal"];
export type WallpaperSource = (typeof WALLPAPER_SOURCES)[number];
export type RemoteWallpaperSource = (typeof REMOTE_WALLPAPER_SOURCES)[number];
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];
export type ImageIntent = "search" | "generate" | "auto";
export type AiImageProvider = "openai" | "nano_banana" | "silicon_flow";
export type RequestMode = "search" | "featured" | "daily" | "category";
export type WallpaperVariant = "thumbnail" | "preview" | "full" | "original";
export type WallpaperDeliveryTier = "free" | "premium";
export type WallpaperDeliveryMode = "original" | "watermarked";
export interface WallpaperUrls {
    thumbnail: string;
    preview: string;
    full: string;
    original: string;
}
export interface WallpaperMetadata {
    width: number;
    height: number;
    color: string;
    blurHash: string;
    description: string;
    tags: string[];
}
export interface Photographer {
    name: string;
    url: string;
    avatar?: string;
}
export interface WallpaperDelivery {
    tier: WallpaperDeliveryTier;
    mode: WallpaperDeliveryMode;
    isWatermarked: boolean;
    watermarkVersion: string | null;
    transformedVariants: WallpaperVariant[];
}
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
    delivery?: WallpaperDelivery;
}
export interface SearchQuery {
    query: string;
    category?: string;
    page?: number;
    perPage?: number;
    mode?: RequestMode;
    intent?: ImageIntent;
    provider?: AiImageProvider;
    fallbackChain?: AiImageProvider[];
    model?: string;
    size?: string;
    quality?: string;
    style?: string;
    negativePrompt?: string;
    persist?: boolean;
    userId?: string;
}
export interface ApiClientRequest {
    query: string;
    category: string;
    page: number;
    perPage: number;
    mode: RequestMode;
}
export interface ClientResponse<T = unknown> {
    source: RemoteWallpaperSource;
    data: T;
    fetchedAt: number;
    latencyMs: number;
    request: ApiClientRequest;
    headers: Record<string, string>;
    rateLimit: RateLimitSnapshot | null;
}
export interface CacheEntry<T> {
    key: string;
    data: T;
    createdAt: number;
    expiresAt: number;
    staleAt: number;
    lastAccessedAt: number;
}
export interface CacheLookupResult<T> {
    data: T;
    state: "fresh" | "stale";
}
export interface QuotaLimits {
    minute?: number;
    hourly?: number;
    monthly?: number;
    reserveRatio: number;
    requiresKey: boolean;
}
export interface RateLimitSnapshot {
    limit: number | "infinite" | null;
    remaining: number | "infinite" | null;
    resetAt: number | null;
}
export interface SourceQuotaSnapshot {
    source: WallpaperSource;
    healthy: boolean;
    configured: boolean;
    remaining: number | "infinite";
    latency: number | null;
    minuteRemaining?: number | "infinite";
    hourlyRemaining?: number | "infinite";
    monthlyRemaining?: number | "infinite";
    observedLimit?: number | "infinite" | null;
    observedRemaining?: number | "infinite" | null;
    rateLimitResetAt?: number | null;
    totalRequests: number;
    failures: number;
}
export interface RoutingDecision {
    source: RemoteWallpaperSource;
    reason: string;
    chain: RemoteWallpaperSource[];
}
export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    staleHits: number;
    writes: number;
    hitRate: number;
    oldestEntry: number | null;
}
export interface EngineHealthReport {
    unsplash: SourceQuotaSnapshot;
    pexels: SourceQuotaSnapshot;
    pixabay: SourceQuotaSnapshot;
    nasa: SourceQuotaSnapshot;
    picsum: SourceQuotaSnapshot;
    cache: CacheStats;
    overall: string;
}
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
