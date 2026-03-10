"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPicsum = fetchPicsum;
// Picsum client: simple, unlimited, and intentionally boring.
// It exists so the engine has a live fallback even when every quota-based source is unavailable.
const config_1 = require("../config");
const utils_1 = require("../utils");
// This client is our unlimited safety net when premium sources fail or are skipped.
// Returns a page of generic images from Picsum.
async function fetchPicsum(request) {
    const startedAt = Date.now();
    const url = `https://picsum.photos/v2/list?${(0, utils_1.toQueryString)({
        page: request.page,
        limit: request.perPage
    })}`;
    const data = await (0, utils_1.retry)(() => (0, utils_1.fetchJson)(url, {}, config_1.REQUEST_DEFAULTS.requestTimeoutMs), config_1.REQUEST_DEFAULTS.retryAttempts);
    return {
        source: "picsum",
        data,
        fetchedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        request
    };
}
