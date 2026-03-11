import type { ApiClientRequest, Wallpaper } from "../types/wallpaper";
export declare function getBundledOfflineWallpapers(): Wallpaper[];
export declare function searchBundledOfflineWallpapers(request: Pick<ApiClientRequest, "query" | "category" | "page" | "perPage">): Wallpaper[];
