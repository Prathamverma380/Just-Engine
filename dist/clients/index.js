"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPicsum = exports.fetchNasa = exports.fetchPixabay = exports.fetchPexels = exports.fetchUnsplash = exports.clients = void 0;
exports.getClient = getClient;
// This registry is how the engine avoids `switch(source)` everywhere.
const nasa_1 = require("./nasa");
Object.defineProperty(exports, "fetchNasa", { enumerable: true, get: function () { return nasa_1.fetchNasa; } });
const pexels_1 = require("./pexels");
Object.defineProperty(exports, "fetchPexels", { enumerable: true, get: function () { return pexels_1.fetchPexels; } });
const picsum_1 = require("./picsum");
Object.defineProperty(exports, "fetchPicsum", { enumerable: true, get: function () { return picsum_1.fetchPicsum; } });
const pixabay_1 = require("./pixabay");
Object.defineProperty(exports, "fetchPixabay", { enumerable: true, get: function () { return pixabay_1.fetchPixabay; } });
const unsplash_1 = require("./unsplash");
Object.defineProperty(exports, "fetchUnsplash", { enumerable: true, get: function () { return unsplash_1.fetchUnsplash; } });
// Central registry so the engine can look clients up dynamically.
exports.clients = {
    unsplash: unsplash_1.fetchUnsplash,
    pexels: pexels_1.fetchPexels,
    pixabay: pixabay_1.fetchPixabay,
    nasa: nasa_1.fetchNasa,
    picsum: picsum_1.fetchPicsum
};
// Keeps the engine clean and avoids switch statements when selecting a provider client.
function getClient(source) {
    return exports.clients[source];
}
