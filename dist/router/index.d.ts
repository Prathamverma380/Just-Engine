import type { ApiClientRequest, RemoteWallpaperSource, RoutingDecision } from "../types/wallpaper";
export declare function resolveCategory(query: string, category?: string): string;
export declare function getSourcePlan(request: ApiClientRequest): RemoteWallpaperSource[];
export declare function pickSource(request: ApiClientRequest): RoutingDecision;
export declare function getUltimateFallbackSource(): RemoteWallpaperSource | null;
export declare function getDefaultQueryForCategory(category: string): string;
