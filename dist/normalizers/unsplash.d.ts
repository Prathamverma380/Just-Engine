import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { UnsplashSearchResponse } from "../clients/unsplash";
export declare function normalizeUnsplash(response: ClientResponse<UnsplashSearchResponse>): Wallpaper[];
