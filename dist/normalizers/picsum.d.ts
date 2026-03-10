import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { PicsumListResponse } from "../clients/picsum";
export declare function normalizePicsum(response: ClientResponse<PicsumListResponse>): Wallpaper[];
