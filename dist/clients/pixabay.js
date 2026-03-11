"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPixabay = fetchPixabay;
// Pixabay client: broad library, especially useful for illustrations and fallback volume.
const config_1 = require("../config");
const utils_1 = require("../utils");
// Pixabay uses query-string auth instead of headers, so this client keeps that detail isolated.
// Pixabay authenticates through query params, which is why this client looks slightly different from the others.
async function fetchPixabay(request) {
    const startedAt = Date.now();
    const query = (0, utils_1.toQueryString)({
        key: config_1.API_KEYS.pixabay,
        q: request.query,
        page: request.page,
        per_page: request.perPage,
        image_type: "photo",
        orientation: "vertical",
        safesearch: true
    });
    const url = `https://pixabay.com/api/?${query}`;
    const result = await (0, utils_1.retry)(() => (0, utils_1.fetchJsonDetailed)(url, {}, config_1.REQUEST_DEFAULTS.requestTimeoutMs), config_1.REQUEST_DEFAULTS.retryAttempts);
    return {
        source: "pixabay",
        data: result.data,
        fetchedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        request,
        headers: result.headers,
        rateLimit: result.rateLimit
    };
}
