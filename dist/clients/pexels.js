"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPexels = fetchPexels;
// Pexels client: header-auth search against curated commercial-free photography.
const config_1 = require("../config");
const utils_1 = require("../utils");
// Pexels is strong for abstract, minimal, and general curated photography searches.
// Calls Pexels and returns raw provider data plus timing/context for the rest of the engine.
async function fetchPexels(request) {
    const startedAt = Date.now();
    const query = (0, utils_1.toQueryString)({
        query: request.query,
        page: request.page,
        per_page: request.perPage,
        orientation: "portrait"
    });
    const url = `https://api.pexels.com/v1/search?${query}`;
    const result = await (0, utils_1.retry)(() => (0, utils_1.fetchJsonDetailed)(url, {
        headers: {
            Authorization: config_1.API_KEYS.pexels
        }
    }, config_1.REQUEST_DEFAULTS.requestTimeoutMs), config_1.REQUEST_DEFAULTS.retryAttempts);
    return {
        source: "pexels",
        data: result.data,
        fetchedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        request,
        headers: result.headers,
        rateLimit: result.rateLimit
    };
}
