import { type ImageIntent, type QuotaLimits, type RemoteWallpaperSource, type WallpaperCategory } from "../types/wallpaper";
export declare const API_KEYS: {
    readonly unsplash: string;
    readonly pexels: string;
    readonly pixabay: string;
    readonly nasa: string;
};
export declare const FEATURE_FLAGS: {
    readonly allowStaleCache: true;
    readonly enableOfflineBundle: true;
    readonly preferPortrait: true;
    readonly includePicsumFallback: true;
    readonly enableAiGeneration: boolean;
    readonly enableAutoPromptDetection: boolean;
};
export declare const REQUEST_DEFAULTS: {
    readonly perPage: 15;
    readonly maxPerPage: 30;
    readonly requestTimeoutMs: 8000;
    readonly retryAttempts: 2;
};
export declare const AI_SETTINGS: {
    readonly apiKey: string;
    readonly apiUrl: string;
    readonly provider: string;
    readonly defaultModel: string;
    readonly defaultSize: string;
    readonly defaultQuality: string;
    readonly defaultStyle: string;
    readonly defaultIntent: ImageIntent;
    readonly timeoutMs: number;
    readonly promptWordThreshold: number;
    readonly maxImagesPerRequest: 1;
};
export declare const CACHE_SETTINGS: {
    readonly ttlMs: number;
    readonly staleTtlMs: number;
    readonly maxEntries: 500;
    readonly prefetchCategories: string[];
};
export declare const SOURCE_LIMITS: Record<RemoteWallpaperSource, QuotaLimits>;
export declare const CATEGORY_SOURCE_PRIORITY: Record<string, RemoteWallpaperSource[]>;
export declare const CATEGORY_QUERIES: Record<WallpaperCategory, string>;
export declare const FEATURED_ROTATION: readonly [{
    readonly query: "cinematic nature wallpaper";
    readonly category: "nature";
}, {
    readonly query: "minimal dark wallpaper";
    readonly category: "dark";
}, {
    readonly query: "cosmic nebula wallpaper";
    readonly category: "space";
}, {
    readonly query: "abstract fluid art wallpaper";
    readonly category: "abstract";
}, {
    readonly query: "night city wallpaper";
    readonly category: "city";
}];
export declare const CATEGORY_KEYWORDS: Record<string, string[]>;
export declare const ENGINE_CONSTANTS: {
    readonly dailyCacheKey: "daily:space:1";
    readonly featuredCacheKey: "featured:all:1";
};
export declare function isSourceConfigured(source: RemoteWallpaperSource): boolean;
