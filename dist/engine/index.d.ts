import { ENGINE_CONSTANTS } from "../config";
import type { EngineHealthReport, EngineStats, Wallpaper } from "../types/wallpaper";
declare function search(query: string, category?: string, page?: number): Promise<Wallpaper[]>;
declare function getFeatured(): Promise<Wallpaper[]>;
declare function getByCategory(category: string, page?: number): Promise<Wallpaper[]>;
declare function getTrending(page?: number): Promise<Wallpaper[]>;
declare function getDaily(): Promise<Wallpaper>;
declare function warmCache(categories?: string[]): Promise<Record<string, number>>;
declare function startCacheWarmScheduler(intervalMs?: number, categories?: string[]): {
    intervalMs: number;
    categories: string[];
};
declare function stopCacheWarmScheduler(): void;
declare function healthCheck(): Promise<EngineHealthReport>;
declare function getStats(): Promise<EngineStats>;
export declare const engine: {
    search: typeof search;
    getFeatured: typeof getFeatured;
    getTrending: typeof getTrending;
    getByCategory: typeof getByCategory;
    getDaily: typeof getDaily;
    warmCache: typeof warmCache;
    startCacheWarmScheduler: typeof startCacheWarmScheduler;
    stopCacheWarmScheduler: typeof stopCacheWarmScheduler;
    healthCheck: typeof healthCheck;
    getStats: typeof getStats;
};
export { search, getFeatured, getTrending, getByCategory, getDaily, warmCache, startCacheWarmScheduler, stopCacheWarmScheduler, healthCheck, getStats, ENGINE_CONSTANTS };
