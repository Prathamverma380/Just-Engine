"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUnsplash = fetchUnsplash;
const config_1 = require("../config");
const utils_1 = require("../utils");
// Unsplash is our preferred source for nature and high-quality photography.
async function fetchUnsplash(request) {
    const startedAt = Date.now();
    const query = (0, utils_1.toQueryString)({
        query: request.query,
        page: request.page,
        per_page: request.perPage,
        orientation: "portrait"
    });
    const url = `https://api.unsplash.com/search/photos?${query}`;
    const result = await (0, utils_1.retry)(() => (0, utils_1.fetchJsonDetailed)(url, {
        headers: {
            Authorization: `Client-ID ${config_1.API_KEYS.unsplash}`
        }
    }, config_1.REQUEST_DEFAULTS.requestTimeoutMs), config_1.REQUEST_DEFAULTS.retryAttempts);
    return {
        source: "unsplash",
        data: result.data,
        fetchedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        request,
        headers: result.headers,
        rateLimit: result.rateLimit
    };
}
