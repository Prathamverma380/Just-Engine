import type { CacheLookupResult, CacheStats, Wallpaper } from "../types/wallpaper";
export declare function generateCacheKey(query: string, category: string, page: number, mode?: string): string;
export declare function cacheGet(key: string, options?: {
    allowStale?: boolean;
}): CacheLookupResult<Wallpaper[]> | null;
export declare function cacheSet(key: string, data: Wallpaper[], ttlMs?: number, staleTtlMs?: number): void;
export declare function cacheHas(key: string): boolean;
export declare function cacheClear(): void;
export declare function cacheResetMemory(): void;
export declare function localBundleUpsert(wallpapers: Wallpaper[]): void;
export declare function localBundleSearch(query: string, category: string, page: number, perPage: number): Wallpaper[];
export declare function localBundleClear(): void;
export declare function cacheStats(): CacheStats;
