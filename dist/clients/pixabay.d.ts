import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";
export interface PixabayHit {
    id: number;
    webformatURL?: string;
    largeImageURL?: string;
    fullHDURL?: string;
    imageURL?: string;
    user?: string;
    userImageURL?: string;
    tags?: string;
    imageWidth?: number;
    imageHeight?: number;
}
export interface PixabaySearchResponse {
    hits?: PixabayHit[];
}
export declare function fetchPixabay(request: ApiClientRequest): Promise<ClientResponse<PixabaySearchResponse>>;
