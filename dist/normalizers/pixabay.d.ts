import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PixabaySearchResponse } from "../clients/pixabay";
export declare function normalizePixabay(response: ClientResponse<PixabaySearchResponse>): Wallpaper[];
