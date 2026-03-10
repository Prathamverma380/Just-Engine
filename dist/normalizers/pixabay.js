"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePixabay = normalizePixabay;
// Pixabay normalizer: especially useful because Pixabay tags come in as CSV strings.
const utils_1 = require("../utils");
// Converts Pixabay's image fields and comma-separated tags into a clean wallpaper list.
// Converts Pixabay's field names into the same wallpaper object used everywhere else.
function normalizePixabay(response) {
    const items = response.data.hits ?? [];
    return (0, utils_1.dedupeWallpapers)(items.map((item) => (0, utils_1.buildWallpaper)({
        source: "pixabay",
        sourceId: String(item.id),
        urls: {
            thumbnail: item.webformatURL,
            preview: item.largeImageURL ?? item.webformatURL,
            full: item.fullHDURL ?? item.largeImageURL,
            original: item.imageURL ?? item.fullHDURL ?? item.largeImageURL
        },
        width: item.imageWidth,
        height: item.imageHeight,
        description: item.tags,
        tags: (0, utils_1.splitTags)(item.tags),
        photographerName: item.user,
        photographerUrl: "",
        photographerAvatar: item.userImageURL,
        category: response.request.category,
        query: response.request.query,
        cachedAt: response.fetchedAt
    })));
}
