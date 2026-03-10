import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";
export interface UnsplashPhoto {
    id: string;
    width?: number;
    height?: number;
    color?: string;
    description?: string | null;
    alt_description?: string | null;
    blur_hash?: string | null;
    urls?: {
        raw?: string;
        full?: string;
        regular?: string;
        small?: string;
        thumb?: string;
    };
    user?: {
        name?: string;
        links?: {
            html?: string;
        };
        profile_image?: {
            small?: string;
        };
    };
    tags?: Array<{
        title?: string;
    }>;
}
export interface UnsplashSearchResponse {
    results?: UnsplashPhoto[];
}
export declare function fetchUnsplash(request: ApiClientRequest): Promise<ClientResponse<UnsplashSearchResponse>>;
