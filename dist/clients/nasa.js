"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNasa = fetchNasa;
// NASA client: this one has two personalities.
// Search mode uses the NASA image library; daily mode uses APOD.
const config_1 = require("../config");
const utils_1 = require("../utils");
// NASA is special: normal search uses the image library, while daily mode uses APOD.
// The caller does not need to care which NASA endpoint was used.
// The client chooses based on request mode and returns raw data plus metadata.
async function fetchNasa(request) {
    const startedAt = Date.now();
    const url = request.mode === "daily"
        ? `https://api.nasa.gov/planetary/apod?${(0, utils_1.toQueryString)({
            api_key: config_1.API_KEYS.nasa || "DEMO_KEY"
        })}`
        : `https://images-api.nasa.gov/search?${(0, utils_1.toQueryString)({
            q: request.query,
            media_type: "image",
            page: request.page
        })}`;
    const data = await (0, utils_1.retry)(() => (0, utils_1.fetchJson)(url, {}, config_1.REQUEST_DEFAULTS.requestTimeoutMs), config_1.REQUEST_DEFAULTS.retryAttempts);
    return {
        source: "nasa",
        data,
        fetchedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        request
    };
}
