"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePicsum = exports.normalizeNasa = exports.normalizePixabay = exports.normalizePexels = exports.normalizeUnsplash = exports.normalizers = void 0;
exports.getNormalizer = getNormalizer;
// After client selection, the engine uses this map to choose the matching raw->unified conversion function.
const nasa_1 = require("./nasa");
Object.defineProperty(exports, "normalizeNasa", { enumerable: true, get: function () { return nasa_1.normalizeNasa; } });
const pexels_1 = require("./pexels");
Object.defineProperty(exports, "normalizePexels", { enumerable: true, get: function () { return pexels_1.normalizePexels; } });
const picsum_1 = require("./picsum");
Object.defineProperty(exports, "normalizePicsum", { enumerable: true, get: function () { return picsum_1.normalizePicsum; } });
const pixabay_1 = require("./pixabay");
Object.defineProperty(exports, "normalizePixabay", { enumerable: true, get: function () { return pixabay_1.normalizePixabay; } });
const unsplash_1 = require("./unsplash");
Object.defineProperty(exports, "normalizeUnsplash", { enumerable: true, get: function () { return unsplash_1.normalizeUnsplash; } });
// Central registry parallel to the clients map.
exports.normalizers = {
    unsplash: (response) => (0, unsplash_1.normalizeUnsplash)(response),
    pexels: (response) => (0, pexels_1.normalizePexels)(response),
    pixabay: (response) => (0, pixabay_1.normalizePixabay)(response),
    nasa: (response) => (0, nasa_1.normalizeNasa)(response),
    picsum: (response) => (0, picsum_1.normalizePicsum)(response)
};
// Lets the engine select a normalizer dynamically after it selects a source.
function getNormalizer(source) {
    return exports.normalizers[source];
}
