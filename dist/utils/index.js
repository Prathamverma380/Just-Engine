"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBytes = formatBytes;
exports.isValidUrl = isValidUrl;
exports.generateId = generateId;
exports.delay = delay;
exports.retry = retry;
exports.truncate = truncate;
exports.toQueryString = toQueryString;
exports.fetchJson = fetchJson;
exports.headersToRecord = headersToRecord;
exports.parseRateLimitSnapshot = parseRateLimitSnapshot;
exports.fetchJsonDetailed = fetchJsonDetailed;
exports.clamp = clamp;
exports.sanitizeColor = sanitizeColor;
exports.splitTags = splitTags;
exports.capitalizeWords = capitalizeWords;
exports.sanitizeDescription = sanitizeDescription;
exports.buildWallpaper = buildWallpaper;
exports.dedupeWallpapers = dedupeWallpapers;
exports.average = average;
exports.formatUptime = formatUptime;
exports.hashString = hashString;
exports.getDayOfYear = getDayOfYear;
exports.createSvgDataUrl = createSvgDataUrl;
exports.createOfflineWallpapers = createOfflineWallpapers;
exports.normalizeQuery = normalizeQuery;
exports.getWallpaperUrl = getWallpaperUrl;
exports.getBestWallpaperUrl = getBestWallpaperUrl;
exports.buildSharePayload = buildSharePayload;
exports.downloadWallpaper = downloadWallpaper;
exports.cacheWallpaperThumbnail = cacheWallpaperThumbnail;
exports.getCachedThumbnailPath = getCachedThumbnailPath;
exports.cacheWallpaperBundle = cacheWallpaperBundle;
exports.setAsWallpaper = setAsWallpaper;
const access_1 = require("../access");
const auth_1 = require("../auth");
const persistence_1 = require("../persistence");
const watermark_1 = require("../watermark");
function assertSynchronousViewerAccess() {
    if (!(0, auth_1.getAuthSession)()) {
        throw new Error("authentication_required");
    }
}
function assertSynchronousAiAccess(wallpaper) {
    if (wallpaper.source !== "ai") {
        return;
    }
    const entitlement = (0, access_1.getCachedViewerEntitlement)();
    if (!(0, access_1.isPremiumEntitlement)(entitlement)) {
        throw new Error("subscription_required");
    }
}
// Human-friendly byte formatting for logs and future UI surfaces.
function formatBytes(bytes) {
    if (bytes <= 0) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
// We treat both normal URLs and generated data URLs as valid image sources.
function isValidUrl(value) {
    if (!value) {
        return false;
    }
    try {
        new URL(value);
        return true;
    }
    catch {
        return value.startsWith("data:image/");
    }
}
// Used for ids that do not come from an upstream provider.
function generateId(prefix = "wp") {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}
// Tiny helper to pause between retries.
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
// Retries are intentionally modest so we recover from transient issues without making latency spiral.
async function retry(fn, attempts = 2) {
    let lastError;
    for (let index = 0; index < attempts; index += 1) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (index < attempts - 1) {
                await delay(150 * (index + 1));
            }
        }
    }
    throw lastError;
}
// Keeps noisy provider error bodies readable in the terminal.
function truncate(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}
// Central query-string builder so clients do not hand-roll URL params differently.
function toQueryString(params) {
    const urlSearchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "") {
            continue;
        }
        urlSearchParams.set(key, String(value));
    }
    return urlSearchParams.toString();
}
// Shared fetch wrapper that enforces timeout and better error messages across all clients.
async function fetchJson(url, init = {}, timeoutMs = 8000) {
    const result = await fetchJsonDetailed(url, init, timeoutMs);
    return result.data;
}
function parseQuotaNumber(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized === "infinite" || normalized === "unlimited") {
        return "infinite";
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseRateLimitResetAt(value) {
    if (!value) {
        return null;
    }
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    if (parsed > 1_000_000_000_000) {
        return Math.round(parsed);
    }
    if (parsed > 1_000_000_000) {
        return Math.round(parsed * 1000);
    }
    return Date.now() + Math.round(parsed * 1000);
}
function readFirstHeader(headers, keys) {
    for (const key of keys) {
        const value = headers[key];
        if (value) {
            return value;
        }
    }
    return undefined;
}
function headersToRecord(headers) {
    const record = {};
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value;
    });
    return record;
}
function parseRateLimitSnapshot(headers) {
    const limit = parseQuotaNumber(readFirstHeader(headers, [
        "x-ratelimit-limit",
        "ratelimit-limit",
        "x-rate-limit-limit",
        "x-rate-limit-requests-limit"
    ]));
    const remaining = parseQuotaNumber(readFirstHeader(headers, [
        "x-ratelimit-remaining",
        "ratelimit-remaining",
        "x-rate-limit-remaining",
        "x-rate-limit-requests-remaining"
    ]));
    const resetAt = parseRateLimitResetAt(readFirstHeader(headers, [
        "x-ratelimit-reset",
        "ratelimit-reset",
        "x-rate-limit-reset",
        "x-rate-limit-reset-after",
        "retry-after"
    ]));
    if (limit === null && remaining === null && resetAt === null) {
        return null;
    }
    return {
        limit,
        remaining,
        resetAt
    };
}
async function fetchJsonDetailed(url, init = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal
        });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status} for ${url}${body ? ` :: ${truncate(body, 160)}` : ""}`);
        }
        const headers = headersToRecord(response.headers);
        return {
            data: (await response.json()),
            headers,
            rateLimit: parseRateLimitSnapshot(headers)
        };
    }
    finally {
        clearTimeout(timeoutId);
    }
}
// Simple numeric clamp used when sanitizing incoming pagination values.
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
// Providers sometimes omit colors or send odd values, so we normalize them here.
function sanitizeColor(value, fallback = "#1f2937") {
    if (!value) {
        return fallback;
    }
    const normalized = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        return normalized.toLowerCase();
    }
    return fallback;
}
// Tags can come in as CSV strings or arrays; this normalizes both into a clean deduped list.
function splitTags(value) {
    if (!value) {
        return [];
    }
    const pieces = Array.isArray(value) ? value : value.split(",");
    return Array.from(new Set(pieces
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)));
}
// Used for nicer fallback titles and generated descriptions.
function capitalizeWords(value) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
        .join(" ");
}
// Ensures every wallpaper has human-readable descriptive text.
function sanitizeDescription(value, category, query) {
    if (value && value.trim().length > 0) {
        return value.trim();
    }
    const base = query.trim().length > 0 ? query : category;
    return `${capitalizeWords(base)} wallpaper`;
}
// Picks the first URL that is actually usable instead of blindly trusting provider payload order.
function pickFirstValidUrl(candidates, fallback) {
    for (const candidate of candidates) {
        if (candidate && isValidUrl(candidate)) {
            return candidate;
        }
    }
    return fallback;
}
// This is the normalization helper every provider-specific normalizer eventually funnels through.
function buildWallpaper(input) {
    const safeColor = sanitizeColor(input.color);
    const fallbackTitle = capitalizeWords(input.query.trim() || input.category.trim() || "Wallpaper");
    const fallbackUrl = createSvgDataUrl(fallbackTitle, safeColor, "#111827");
    const preview = pickFirstValidUrl([input.urls.preview, input.urls.full, input.urls.thumbnail, input.urls.original], fallbackUrl);
    const thumbnail = pickFirstValidUrl([input.urls.thumbnail, input.urls.preview, input.urls.full, input.urls.original], preview);
    const full = pickFirstValidUrl([input.urls.full, input.urls.original, input.urls.preview, input.urls.thumbnail], preview);
    const original = pickFirstValidUrl([input.urls.original, input.urls.full, input.urls.preview, input.urls.thumbnail], full);
    const photographer = {
        name: input.photographerName?.trim() || "Unknown",
        url: input.photographerUrl?.trim() || ""
    };
    if (input.photographerAvatar?.trim()) {
        photographer.avatar = input.photographerAvatar.trim();
    }
    return {
        id: `wp_${input.source}_${String(input.sourceId).replace(/[^\w-]/g, "").slice(0, 40) || generateId("id")}`,
        source: input.source,
        sourceId: String(input.sourceId),
        urls: {
            thumbnail,
            preview,
            full,
            original
        },
        metadata: {
            width: input.width && input.width > 0 ? input.width : 1080,
            height: input.height && input.height > 0 ? input.height : 1920,
            color: safeColor,
            blurHash: input.blurHash ?? "",
            description: sanitizeDescription(input.description, input.category, input.query),
            tags: splitTags(input.tags)
        },
        photographer,
        category: input.category,
        isFavorite: false,
        downloadedAt: null,
        cachedAt: input.cachedAt ?? Date.now()
    };
}
// Some providers overlap heavily, so we dedupe by source + sourceId before returning results.
function dedupeWallpapers(wallpapers) {
    const seen = new Set();
    const deduped = [];
    for (const wallpaper of wallpapers) {
        const key = `${wallpaper.source}:${wallpaper.sourceId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(wallpaper);
    }
    return deduped;
}
// Used in stats reporting.
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
// Converts runtime duration into something a human can scan quickly.
function formatUptime(startedAt) {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}
// Lightweight deterministic hash for stable local ids and offline seeds.
function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
// Used to rotate featured content daily without external scheduling.
function getDayOfYear(date = new Date()) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / 86400000);
}
// This powers the true offline fallback so the engine can still return a valid image payload without network.
function createSvgDataUrl(title, colorA, colorB) {
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2560" viewBox="0 0 1440 2560">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${colorA}" />
          <stop offset="100%" stop-color="${colorB}" />
        </linearGradient>
      </defs>
      <rect width="1440" height="2560" fill="url(#g)" />
      <circle cx="1130" cy="500" r="280" fill="rgba(255,255,255,0.12)" />
      <circle cx="280" cy="2100" r="230" fill="rgba(255,255,255,0.08)" />
      <text x="120" y="2240" fill="#ffffff" font-size="82" font-family="Georgia, serif">${title}</text>
      <text x="120" y="2350" fill="rgba(255,255,255,0.78)" font-size="38" font-family="Georgia, serif">Wallpaper Engine Offline Collection</text>
    </svg>
  `.trim();
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
// Generates a local emergency collection when every remote source is unavailable.
function createOfflineWallpapers(request) {
    const palettes = [
        ["#0f172a", "#1d4ed8"],
        ["#111827", "#7c3aed"],
        ["#052e16", "#15803d"],
        ["#3f0d12", "#a71d31"],
        ["#1f2937", "#0ea5e9"]
    ];
    return Array.from({ length: request.perPage }, (_, index) => {
        const palette = palettes[(index + request.page) % palettes.length] ?? ["#0f172a", "#1d4ed8"];
        const title = capitalizeWords(`${request.category} ${index + 1}`);
        const dataUrl = createSvgDataUrl(title, palette[0], palette[1]);
        return buildWallpaper({
            source: "local",
            sourceId: `${hashString(`${request.query}:${request.category}:${request.page}:${index}`)}_${index}`,
            urls: {
                thumbnail: dataUrl,
                preview: dataUrl,
                full: dataUrl,
                original: dataUrl
            },
            width: 1440,
            height: 2560,
            color: palette[0],
            description: `${title} from the offline bundle`,
            tags: [request.category, request.query, "offline", "fallback"],
            photographerName: "Wallpaper Engine",
            photographerUrl: "",
            category: request.category,
            query: request.query
        });
    });
}
// Final cleanup pass before requests reach the router and clients.
function normalizeQuery(request) {
    return {
        ...request,
        query: request.query.trim(),
        category: request.category.trim().toLowerCase() || "all"
    };
}
// Picks the exact variant the caller wants without exposing provider-specific URL naming.
function getWallpaperUrl(wallpaper, variant = "preview") {
    return wallpaper.urls[variant];
}
// Chooses a sensible image size for the target screen while staying bandwidth-aware.
function getBestWallpaperUrl(wallpaper, deviceWidth = 1080, deviceHeight = 1920) {
    const longestSide = Math.max(deviceWidth, deviceHeight);
    if (longestSide <= 480) {
        return wallpaper.urls.thumbnail;
    }
    if (longestSide <= 1440) {
        return wallpaper.urls.preview;
    }
    if (longestSide <= 2560) {
        return wallpaper.urls.full;
    }
    return wallpaper.urls.original;
}
// Converts a wallpaper into something a sharing layer can use later.
function buildSharePayload(wallpaper) {
    assertSynchronousViewerAccess();
    assertSynchronousAiAccess(wallpaper);
    return {
        title: wallpaper.metadata.description,
        text: `${wallpaper.metadata.description} by ${wallpaper.photographer.name}`,
        url: wallpaper.urls.original
    };
}
function inferExtension(url, contentType) {
    if (contentType.includes("png")) {
        return "png";
    }
    if (contentType.includes("webp")) {
        return "webp";
    }
    if (contentType.includes("svg")) {
        return "svg";
    }
    const match = url.match(/\.([a-zA-Z0-9]{3,4})(?:\?|$)/);
    return match?.[1]?.toLowerCase() ?? "jpg";
}
// Downloads the chosen wallpaper variant into a local folder for offline use or later OS integration.
async function downloadWallpaper(wallpaper, options = {}) {
    await (0, access_1.requireAuthenticatedViewer)();
    if (wallpaper.source === "ai") {
        await (0, access_1.requirePremiumViewer)();
    }
    const fs = require("fs");
    const path = require("path");
    const variant = options.variant ?? "full";
    const watermarkOptions = {
        ...(options.deliveryTier ? { tier: options.deliveryTier } : {}),
        ...(options.watermarkVersion ? { watermarkVersion: options.watermarkVersion } : {}),
        ...(options.watermarkText ? { watermarkText: options.watermarkText } : {}),
        ...(options.watermarkSubtext ? { watermarkSubtext: options.watermarkSubtext } : {}),
        ...(options.forceRefresh ? { forceRefresh: options.forceRefresh } : {})
    };
    const url = await (0, watermark_1.getDeliveredWallpaperUrl)(wallpaper, variant, watermarkOptions);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download wallpaper: HTTP ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const extension = inferExtension(url, contentType);
    const downloadsDir = (0, persistence_1.ensureDataDirectory)(options.directoryName ?? "downloads");
    const deliverySuffix = options.deliveryTier === "free" ? "-free" : "";
    const fileName = options.fileName ?? `${wallpaper.id}${deliverySuffix}.${extension}`;
    const filePath = path.join(downloadsDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return {
        filePath,
        bytesWritten: buffer.byteLength,
        contentType
    };
}
// Downloads and stores a small local thumbnail so list/grid views can avoid repeated network fetches.
async function cacheWallpaperThumbnail(wallpaper, options = {}) {
    const path = require("path");
    const cacheDirectoryName = options.deliveryTier === "free" ? "thumbnails\\free" : "thumbnails";
    const cacheDir = (0, persistence_1.ensureDataDirectory)(cacheDirectoryName);
    const existingPath = getCachedThumbnailPath(wallpaper, options);
    if (existingPath) {
        return existingPath;
    }
    const result = await downloadWallpaper(wallpaper, {
        variant: "thumbnail",
        directoryName: cacheDirectoryName,
        fileName: options.deliveryTier === "free"
            ? `${wallpaper.id}-free.svg`
            : `${wallpaper.id}.${inferExtension(wallpaper.urls.thumbnail, "image/jpeg")}`,
        ...(options.deliveryTier ? { deliveryTier: options.deliveryTier } : {})
    });
    return path.normalize(path.join(cacheDir, path.basename(result.filePath)));
}
// Reads the deterministic thumbnail path if it is already cached on disk.
function getCachedThumbnailPath(wallpaper, options = {}) {
    if (typeof require === "undefined") {
        return null;
    }
    try {
        const fs = require("fs");
        const path = require("path");
        const cacheDir = (0, persistence_1.ensureDataDirectory)(options.deliveryTier === "free" ? "thumbnails\\free" : "thumbnails");
        const prefix = options.deliveryTier === "free" ? `${wallpaper.id}-free.` : `${wallpaper.id}.`;
        const candidates = fs.readdirSync(cacheDir).filter((file) => file.startsWith(prefix));
        if (candidates.length === 0) {
            return null;
        }
        return path.join(cacheDir, candidates[0]);
    }
    catch {
        return null;
    }
}
// Stores both the lightweight thumbnail and a larger preview so browsed images accumulate into a usable local bundle.
async function cacheWallpaperBundle(wallpaper, options = {}) {
    const previewDirectory = options.deliveryTier === "free" ? "bundle\\free\\previews" : "bundle\\previews";
    const thumbnailPath = await cacheWallpaperThumbnail(wallpaper, options.deliveryTier ? { deliveryTier: options.deliveryTier } : {});
    const previewResult = await downloadWallpaper(wallpaper, {
        variant: "preview",
        directoryName: previewDirectory,
        fileName: options.deliveryTier === "free"
            ? `${wallpaper.id}-free.svg`
            : `${wallpaper.id}.${inferExtension(wallpaper.urls.preview, "image/jpeg")}`,
        ...(options.deliveryTier ? { deliveryTier: options.deliveryTier } : {})
    });
    return {
        thumbnailPath,
        previewPath: previewResult.filePath
    };
}
// This offers a real backend implementation on Windows while remaining explicit about unsupported hosts.
async function setAsWallpaper(wallpaper) {
    if (typeof require === "undefined") {
        throw new Error("Wallpaper setting is unavailable in this runtime.");
    }
    const processModule = require("process");
    if (processModule.platform !== "win32") {
        throw new Error(`Setting wallpaper is currently supported only on Windows. Current platform: ${processModule.platform}`);
    }
    const path = require("path");
    const { execFileSync } = require("child_process");
    const download = await downloadWallpaper(wallpaper, {
        variant: "full",
        directoryName: "wallpapers",
        fileName: `${wallpaper.id}.jpg`
    });
    const absolutePath = path.resolve(download.filePath);
    const powershellScript = `
Add-Type @"
using System.Runtime.InteropServices;
public class NativeWallpaper {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[void][NativeWallpaper]::SystemParametersInfo(20, 0, "${absolutePath.replace(/\\/g, "\\\\")}", 3)
`;
    execFileSync("powershell", ["-NoProfile", "-Command", powershellScript], {
        stdio: "ignore"
    });
    return absolutePath;
}
