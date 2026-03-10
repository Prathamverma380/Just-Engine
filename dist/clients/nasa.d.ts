import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";
export interface NasaImageItem {
    data?: Array<{
        nasa_id?: string;
        title?: string;
        description?: string;
        keywords?: string[];
        photographer?: string;
        date_created?: string;
    }>;
    links?: Array<{
        href?: string;
    }>;
}
export interface NasaSearchResponse {
    collection?: {
        items?: NasaImageItem[];
    };
}
export interface NasaApodResponse {
    date?: string;
    title?: string;
    explanation?: string;
    url?: string;
    hdurl?: string;
    media_type?: string;
    copyright?: string;
}
export declare function fetchNasa(request: ApiClientRequest): Promise<ClientResponse<NasaSearchResponse | NasaApodResponse>>;
