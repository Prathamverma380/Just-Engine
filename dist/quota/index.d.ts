import { type RateLimitSnapshot, type RemoteWallpaperSource, type SourceQuotaSnapshot } from "../types/wallpaper";
export declare function recordUsage(source: RemoteWallpaperSource, result: {
    success: boolean;
    latencyMs?: number | null;
    rateLimit?: RateLimitSnapshot | null;
}): void;
export declare function getRemaining(source: RemoteWallpaperSource): {
    minute: number | "infinite";
    hourly: number | "infinite";
    monthly: number | "infinite";
};
export declare function hasQuota(source: RemoteWallpaperSource): boolean;
export declare function isHealthy(source: RemoteWallpaperSource): boolean;
export declare function resetHourly(): void;
export declare function getQuotaReport(): Record<RemoteWallpaperSource, SourceQuotaSnapshot>;
