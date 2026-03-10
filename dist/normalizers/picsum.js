"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePicsum = normalizePicsum;
// Picsum normalizer: mostly just manufactures the size variants the engine expects.
const utils_1 = require("../utils");
// Picsum gives us simple image metadata, so normalization here is mostly URL shaping.
// Even the simplest source gets normalized so the engine can stay API-agnostic.
function normalizePicsum(response) {
    const items = response.data ?? [];
    return (0, utils_1.dedupeWallpapers)(items.map((item) => (0, utils_1.buildWallpaper)({
        source: "picsum",
        sourceId: item.id,
        urls: {
            thumbnail: `/api/wallpaper/picsum/${item.id}/thumbnail`,
            preview: `/api/wallpaper/picsum/${item.id}/preview`,
            full: `/api/wallpaper/picsum/${item.id}/full`,
            original: `/api/wallpaper/picsum/${item.id}/original`
            // thumbnail: `https://picsum.photos/id/${item.id}/320/568`,
            // preview: `https://picsum.photos/id/${item.id}/900/1600`,
            // full: `https://picsum.photos/id/${item.id}/1440/2560`,
            // original: `/api/image/${item.id}/full`
            // original: item.download_url
        },
        width: item.width,
        height: item.height,
        color: "#374151",
        description: `${item.author ?? "Picsum"} wallpaper`,
        tags: (0, utils_1.splitTags)([response.request.category, response.request.query, "picsum"]),
        photographerName: item.author,
        photographerUrl: item.url,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
    })));
}
