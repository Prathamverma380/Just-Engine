import type { ApiClientRequest, ClientResponse } from "../types/wallpaper";
export interface PicsumPhoto {
    id: string;
    author?: string;
    width?: number;
    height?: number;
    url?: string;
    download_url?: string;
}
export type PicsumListResponse = PicsumPhoto[];
export declare function fetchPicsum(request: ApiClientRequest): Promise<ClientResponse<PicsumListResponse>>;
