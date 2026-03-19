"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDataRootPath = getDataRootPath;
exports.ensureDataDirectory = ensureDataDirectory;
exports.getDatabase = getDatabase;
exports.safeJsonParse = safeJsonParse;
exports.getPersistencePath = getPersistencePath;
let database = null;
// Reads a single value out of `.env.local` without pulling in a dotenv dependency.
// We use this so the backend still respects project config even when the shell did not export env vars.
function readLocalEnvValue(key) {
    if (typeof require === "undefined" || typeof process === "undefined" || typeof process.cwd !== "function") {
        return null;
    }
    try {
        const fs = require("fs");
        const path = require("path");
        const envPath = path.join(process.cwd(), ".env.local");
        if (!fs.existsSync(envPath)) {
            return null;
        }
        const contents = fs.readFileSync(envPath, "utf8");
        for (const line of contents.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                continue;
            }
            const separatorIndex = trimmed.indexOf("=");
            if (separatorIndex <= 0) {
                continue;
            }
            const currentKey = trimmed.slice(0, separatorIndex).trim();
            if (currentKey !== key) {
                continue;
            }
            return trimmed.slice(separatorIndex + 1).trim();
        }
        return null;
    }
    catch {
        return null;
    }
}
// The user can point the engine at any folder they want.
// Tests can override that with a repo-local path so they never depend on host-specific permissions.
function getConfiguredDataRoot() {
    const configured = process?.env?.WALLPAPER_ENGINE_TEST_DATA_DIR?.trim() ??
        readLocalEnvValue("WALLPAPER_ENGINE_TEST_DATA_DIR") ??
        process?.env?.WALLPAPER_ENGINE_DATA_DIR?.trim() ??
        readLocalEnvValue("WALLPAPER_ENGINE_DATA_DIR");
    return configured && configured.length > 0 ? configured : null;
}
function resolveDataRoot(root) {
    if (typeof require === "undefined") {
        return root;
    }
    try {
        const path = require("path");
        if (path.isAbsolute(root)) {
            return path.normalize(root);
        }
        if (typeof process === "undefined" || typeof process.cwd !== "function") {
            return path.normalize(root);
        }
        return path.resolve(process.cwd(), root);
    }
    catch {
        return root;
    }
}
// This resolves the final root data folder.
// If the user did not override it, we fall back to a local `data/` directory in the repo.
function getDataRootPath() {
    const configured = getConfiguredDataRoot();
    if (configured) {
        return resolveDataRoot(configured);
    }
    if (typeof require === "undefined" || typeof process === "undefined" || typeof process.cwd !== "function") {
        return null;
    }
    try {
        const path = require("path");
        return path.resolve(process.cwd(), "data");
    }
    catch {
        return null;
    }
}
// Every filesystem writer goes through this helper so directory creation is consistent everywhere.
function ensureDataDirectory(directoryName) {
    if (typeof require === "undefined") {
        throw new Error("Filesystem persistence is unavailable in this runtime.");
    }
    const fs = require("fs");
    const path = require("path");
    const root = getDataRootPath();
    if (!root) {
        throw new Error("Unable to resolve a writable data directory.");
    }
    const targetDir = directoryName ? path.join(root, directoryName) : root;
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, {
            recursive: true
        });
    }
    return targetDir;
}
// Creates the SQLite file and the whole schema if needed.
// This is the persistent memory of the engine:
// request cache, local image bundle index, favorites, settings, downloads, and app flags.
function createDatabase() {
    if (typeof require === "undefined" || typeof process === "undefined" || typeof process.cwd !== "function") {
        return null;
    }
    try {
        const path = require("path");
        const { DatabaseSync } = require("node:sqlite");
        const dataDir = ensureDataDirectory();
        const dbPath = path.join(dataDir, "wallpaper-engine.sqlite");
        const db = new DatabaseSync(dbPath);
        db.exec(`
      -- Exact request-response cache.
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        stale_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      -- Searchable local wallpaper library built from real fetched results over time.
      CREATE TABLE IF NOT EXISTS local_bundle (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        category TEXT NOT NULL,
        payload TEXT NOT NULL,
        search_text TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- User-curated favorites.
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Small settings and preferences.
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Local record of what the user downloaded.
      CREATE TABLE IF NOT EXISTS download_history (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        downloaded_at INTEGER NOT NULL
      );

      -- Recent searches for future suggestion/history features.
      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- Misc one-off flags and app state values.
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries (expires_at, stale_at);
      CREATE INDEX IF NOT EXISTS idx_local_bundle_category ON local_bundle (category, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_local_bundle_updated_at ON local_bundle (updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history (created_at DESC);
    `);
        return db;
    }
    catch (error) {
        console.error("[persistence] SQLite unavailable, continuing without disk persistence.", error);
        return null;
    }
}
// Opens the database only when some feature really needs it.
// That keeps simple import paths and pure utility/test paths lighter.
function getDatabase() {
    if (!database) {
        database = createDatabase();
    }
    return database;
}
// Small defensive helper so bad rows or corrupted JSON do not crash the whole engine.
function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
// Useful for debugging and tests so we can print the actual SQLite file location.
function getPersistencePath() {
    if (typeof require === "undefined") {
        return null;
    }
    try {
        const path = require("path");
        const root = getDataRootPath();
        return root ? path.join(root, "wallpaper-engine.sqlite") : null;
    }
    catch {
        return null;
    }
}
