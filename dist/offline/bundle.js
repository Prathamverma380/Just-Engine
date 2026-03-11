"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundledOfflineWallpapers = getBundledOfflineWallpapers;
exports.searchBundledOfflineWallpapers = searchBundledOfflineWallpapers;
const utils_1 = require("../utils");
// This starter bundle gives the engine a real shipped fallback set instead of only generated placeholders.
const OFFLINE_BUNDLE_SEEDS = [
    { id: "nature_alpine_mist", category: "nature", title: "Alpine Mist", description: "Cool mountain ridges fading into morning haze.", tags: ["nature", "mountain", "mist", "landscape"], colors: ["#0f172a", "#3b82f6"] },
    { id: "nature_forest_canopy", category: "nature", title: "Forest Canopy", description: "Dense evergreen canopy with soft filtered light.", tags: ["nature", "forest", "green", "trees"], colors: ["#052e16", "#22c55e"] },
    { id: "nature_ocean_glow", category: "nature", title: "Ocean Glow", description: "Deep-blue shoreline with a bright horizon wash.", tags: ["nature", "ocean", "coast", "sunrise"], colors: ["#082f49", "#38bdf8"] },
    { id: "abstract_fluid_ember", category: "abstract", title: "Fluid Ember", description: "Warm fluid gradients with molten abstract motion.", tags: ["abstract", "fluid", "art", "warm"], colors: ["#450a0a", "#f97316"] },
    { id: "abstract_glass_wave", category: "abstract", title: "Glass Wave", description: "Translucent layered waves with a glassy finish.", tags: ["abstract", "wave", "glass", "shapes"], colors: ["#0f172a", "#14b8a6"] },
    { id: "abstract_ink_bloom", category: "abstract", title: "Ink Bloom", description: "Dark ink bloom with vivid violet diffusion.", tags: ["abstract", "ink", "bloom", "art"], colors: ["#111827", "#8b5cf6"] },
    { id: "space_nebula_horizon", category: "space", title: "Nebula Horizon", description: "A dramatic nebula field stretching across a dark sky.", tags: ["space", "nebula", "galaxy", "astronomy"], colors: ["#020617", "#4338ca"] },
    { id: "space_lunar_blue", category: "space", title: "Lunar Blue", description: "Crisp lunar silhouette with a cool blue atmosphere.", tags: ["space", "moon", "night", "cosmos"], colors: ["#0f172a", "#60a5fa"] },
    { id: "space_cosmic_dust", category: "space", title: "Cosmic Dust", description: "Dense starfield with drifting clouds of cosmic dust.", tags: ["space", "stars", "cosmos", "dust"], colors: ["#030712", "#a855f7"] },
    { id: "dark_amoled_void", category: "dark", title: "AMOLED Void", description: "Near-black composition designed for AMOLED screens.", tags: ["dark", "amoled", "black", "minimal"], colors: ["#020617", "#0f172a"] },
    { id: "dark_neon_grid", category: "dark", title: "Neon Grid", description: "Subtle neon lines over a near-black background.", tags: ["dark", "neon", "amoled", "grid"], colors: ["#030712", "#0ea5e9"] },
    { id: "minimal_soft_stone", category: "minimal", title: "Soft Stone", description: "Minimal composition with quiet neutral balance.", tags: ["minimal", "clean", "simple", "neutral"], colors: ["#e5e7eb", "#94a3b8"] },
    { id: "minimal_paper_fold", category: "minimal", title: "Paper Fold", description: "Clean folded layers with gentle depth.", tags: ["minimal", "paper", "clean", "simple"], colors: ["#f8fafc", "#cbd5e1"] },
    { id: "city_midnight_blocks", category: "city", title: "Midnight Blocks", description: "Sharp city silhouettes under a midnight skyline.", tags: ["city", "urban", "night", "architecture"], colors: ["#111827", "#2563eb"] },
    { id: "city_rain_reflections", category: "city", title: "Rain Reflections", description: "Rain-washed streets glowing with city color.", tags: ["city", "rain", "street", "urban"], colors: ["#1e293b", "#06b6d4"] },
    { id: "animals_wild_tiger", category: "animals", title: "Wild Tiger", description: "Bold wildlife portrait energy with rich contrast.", tags: ["animals", "wildlife", "tiger", "portrait"], colors: ["#451a03", "#f59e0b"] },
    { id: "animals_arctic_fox", category: "animals", title: "Arctic Fox", description: "Calm winter wildlife mood with crisp detail.", tags: ["animals", "wildlife", "fox", "winter"], colors: ["#0f172a", "#cbd5e1"] },
    { id: "illustration_vector_bloom", category: "illustration", title: "Vector Bloom", description: "Curated illustration with bold vector petals.", tags: ["illustration", "vector", "art", "digital"], colors: ["#4c1d95", "#ec4899"] },
    { id: "illustration_poster_sky", category: "illustration", title: "Poster Sky", description: "Graphic illustration with a cinematic sky palette.", tags: ["illustration", "poster", "digital art", "sky"], colors: ["#172554", "#f43f5e"] },
    { id: "gradient_orchid_mesh", category: "gradient", title: "Orchid Mesh", description: "Smooth mesh gradient with orchid and coral tones.", tags: ["gradient", "mesh", "color", "blend"], colors: ["#7c3aed", "#fb7185"] },
    { id: "gradient_teal_sunset", category: "gradient", title: "Teal Sunset", description: "Soft teal-to-orange gradient for a calm screen.", tags: ["gradient", "sunset", "blend", "color"], colors: ["#0f766e", "#fb923c"] },
    { id: "seasonal_winter_glass", category: "seasonal", title: "Winter Glass", description: "Frosted seasonal design with icy highlights.", tags: ["seasonal", "winter", "holiday", "frost"], colors: ["#0f172a", "#7dd3fc"] },
    { id: "seasonal_autumn_fire", category: "seasonal", title: "Autumn Fire", description: "Warm autumn canopy with a fiery palette.", tags: ["seasonal", "autumn", "fall", "leaves"], colors: ["#7c2d12", "#fb923c"] },
    { id: "seasonal_spring_blush", category: "seasonal", title: "Spring Blush", description: "Soft seasonal bloom tones for spring browsing.", tags: ["seasonal", "spring", "flowers", "light"], colors: ["#fbcfe8", "#86efac"] }
];
let cachedBundle = null;
function cloneWallpaper(wallpaper) {
    return {
        ...wallpaper,
        urls: { ...wallpaper.urls },
        metadata: {
            ...wallpaper.metadata,
            tags: [...wallpaper.metadata.tags]
        },
        photographer: { ...wallpaper.photographer }
    };
}
function getBundleSearchText(wallpaper) {
    return [
        wallpaper.category,
        wallpaper.metadata.description,
        wallpaper.photographer.name,
        ...wallpaper.metadata.tags
    ]
        .join(" ")
        .toLowerCase();
}
function getBundledOfflineWallpapers() {
    if (!cachedBundle) {
        cachedBundle = OFFLINE_BUNDLE_SEEDS.map((seed, index) => {
            const dataUrl = (0, utils_1.createSvgDataUrl)(seed.title, seed.colors[0], seed.colors[1]);
            return (0, utils_1.buildWallpaper)({
                source: "local",
                sourceId: seed.id,
                urls: {
                    thumbnail: dataUrl,
                    preview: dataUrl,
                    full: dataUrl,
                    original: dataUrl
                },
                width: 1440,
                height: 2560,
                color: seed.colors[0],
                description: seed.description,
                tags: seed.tags,
                photographerName: "Wallpaper Engine Bundle",
                photographerUrl: "",
                category: seed.category,
                query: seed.title,
                cachedAt: Date.now() - index
            });
        });
    }
    return cachedBundle.map(cloneWallpaper);
}
// The shipped bundle uses the same category and token matching rules as the local image library.
function searchBundledOfflineWallpapers(request) {
    const normalizedCategory = request.category.trim().toLowerCase() || "all";
    const tokens = request.query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const candidates = getBundledOfflineWallpapers().filter((wallpaper) => normalizedCategory === "all" ? true : wallpaper.category.toLowerCase() === normalizedCategory);
    const scored = candidates
        .map((wallpaper) => {
        const haystack = getBundleSearchText(wallpaper);
        const score = tokens.reduce((total, token) => (haystack.includes(token) ? total + 1 : total), 0);
        return {
            wallpaper,
            score
        };
    })
        .filter((entry) => {
        if (tokens.length === 0) {
            return true;
        }
        return entry.score > 0 || normalizedCategory !== "all";
    })
        .sort((left, right) => right.score - left.score || right.wallpaper.cachedAt - left.wallpaper.cachedAt);
    const start = Math.max(0, (request.page - 1) * request.perPage);
    return scored.slice(start, start + request.perPage).map((entry) => entry.wallpaper);
}
