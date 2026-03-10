"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePexels = normalizePexels;
// Pexels normalizer: turn Pexels photo payloads into the engine's one true wallpaper shape.
const utils_1 = require("../utils");
// Maps Pexels image sizes and attribution into our unified contract.
// Most of the work here is just choosing the right Pexels image sizes and attribution fields.
function normalizePexels(response) {
    const items = response.data.photos ?? [];
    return (0, utils_1.dedupeWallpapers)(items.map((item) => (0, utils_1.buildWallpaper)({
        source: "pexels",
        sourceId: String(item.id),
        urls: {
            thumbnail: item.src?.tiny ?? item.src?.small,
            preview: item.src?.medium ?? item.src?.large,
            full: item.src?.large2x ?? item.src?.portrait ?? item.src?.large,
            original: item.src?.original
        },
        width: item.width,
        height: item.height,
        color: item.avg_color,
        description: item.alt ?? undefined,
        tags: (0, utils_1.splitTags)([response.request.category, response.request.query, item.alt ?? ""]),
        photographerName: item.photographer,
        photographerUrl: item.photographer_url,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
    })));
}
