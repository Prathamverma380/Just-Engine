import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PexelsSearchResponse } from "../clients/pexels";
export declare function normalizePexels(response: ClientResponse<PexelsSearchResponse>): Wallpaper[];
