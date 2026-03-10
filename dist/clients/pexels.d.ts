import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";
export interface PexelsPhoto {
    id: number;
    width?: number;
    height?: number;
    avg_color?: string;
    alt?: string;
    photographer?: string;
    photographer_url?: string;
    src?: {
        original?: string;
        large2x?: string;
        large?: string;
        medium?: string;
        small?: string;
        portrait?: string;
        tiny?: string;
    };
}
export interface PexelsSearchResponse {
    photos?: PexelsPhoto[];
}
export declare function fetchPexels(request: ApiClientRequest): Promise<ClientResponse<PexelsSearchResponse>>;
