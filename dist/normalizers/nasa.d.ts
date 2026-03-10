import type { ClientResponse, Wallpaper } from "../types/wallpaper";
import type { NasaApodResponse, NasaSearchResponse } from "../clients/nasa";
export declare function normalizeNasa(response: ClientResponse<NasaSearchResponse | NasaApodResponse>): Wallpaper[];
