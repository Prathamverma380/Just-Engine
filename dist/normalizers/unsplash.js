"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnsplash = normalizeUnsplash;
const utils_1 = require("../utils");
// Converts Unsplash-specific fields into the engine's single wallpaper shape.
function normalizeUnsplash(response) {
    const items = response.data.results ?? [];
    return (0, utils_1.dedupeWallpapers)(items.map((item) => (0, utils_1.buildWallpaper)({
        source: "unsplash",
        sourceId: item.id,
        urls: {
            thumbnail: item.urls?.thumb,
            preview: item.urls?.regular,
            full: item.urls?.full,
            original: item.urls?.raw
        },
        width: item.width,
        height: item.height,
        color: item.color,
        blurHash: item.blur_hash ?? "",
        description: item.description ?? item.alt_description ?? undefined,
        tags: [
            ...(0, utils_1.splitTags)(item.tags?.map((tag) => tag.title ?? "")),
            ...(0, utils_1.splitTags)(response.request.query)
        ],
        photographerName: item.user?.name,
        photographerUrl: item.user?.links?.html,
        photographerAvatar: item.user?.profile_image?.small,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
    })));
}
