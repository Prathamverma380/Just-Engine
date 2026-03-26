"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveFavorite = saveFavorite;
exports.removeFavorite = removeFavorite;
exports.getFavorites = getFavorites;
exports.isFavorite = isFavorite;
exports.savePreference = savePreference;
exports.getPreference = getPreference;
exports.getDownloadHistory = getDownloadHistory;
exports.addToDownloadHistory = addToDownloadHistory;
exports.addSearchHistory = addSearchHistory;
exports.getSearchHistory = getSearchHistory;
exports.setSubscriptionState = setSubscriptionState;
exports.getSubscriptionState = getSubscriptionState;
exports.consumeFirstLaunch = consumeFirstLaunch;
exports.storageClear = storageClear;
// This file is the user-state side of persistence.
// It stores what the user cares about, not what the providers returned.
const access_1 = require("../access");
const auth_1 = require("../auth");
const persistence_1 = require("../persistence");
// Centralized timestamp helper so writes are consistent and easy to change later.
function getNow() {
    return Date.now();
}
function getCurrentUserId() {
    return (0, auth_1.getAuthSession)()?.user.id ?? null;
}
function scopeValue(value, userId) {
    return `${userId}::${value}`;
}
function getScopedValue(value) {
    const userId = getCurrentUserId();
    return userId ? scopeValue(value, userId) : null;
}
function stripScopePrefix(value, userId) {
    const prefix = `${userId}::`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
function canReadStoredWallpaper(wallpaper) {
    if (wallpaper.source !== "ai") {
        return true;
    }
    return (0, access_1.isPremiumEntitlement)((0, access_1.getCachedViewerEntitlement)());
}
function getScopedAppStateKey(key) {
    const userId = getCurrentUserId();
    return userId ? scopeValue(key, userId) : key;
}
// Reads a small app-level setting from persistent state.
// This is for tiny app flags like "first launch" and "subscription state".
function readAppState(key, fallback) {
    const db = (0, persistence_1.getDatabase)();
    if (!db) {
        return fallback;
    }
    const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
    return row ? (0, persistence_1.safeJsonParse)(row.value, fallback) : fallback;
}
// Writes a small app-level setting into persistent state.
// Matching writer for the generic app-state table.
function writeAppState(key, value) {
    const db = (0, persistence_1.getDatabase)();
    if (!db) {
        return;
    }
    const now = getNow();
    db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now);
}
// This now uses SQLite as the source of truth, which matches the doc direction much more closely.
// Favorites are stored as full wallpaper objects so the UI can render them without rebuilding anything.
function saveFavorite(wallpaper) {
    const db = (0, persistence_1.getDatabase)();
    const scopedId = getScopedValue(wallpaper.id);
    if (!db || !scopedId) {
        return;
    }
    const payload = JSON.stringify({
        ...wallpaper,
        isFavorite: true
    });
    db.prepare(`
    INSERT INTO favorites (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(scopedId, payload, getNow());
}
// Removing a favorite should be silent and idempotent.
function removeFavorite(id) {
    const db = (0, persistence_1.getDatabase)();
    const scopedId = getScopedValue(id);
    if (!scopedId) {
        return;
    }
    db?.prepare("DELETE FROM favorites WHERE id = ?").run(scopedId);
}
// Favorites come back as fully serialized wallpaper objects.
// Reading favorites means deserializing the full saved wallpapers back out of SQLite.
function getFavorites() {
    const db = (0, persistence_1.getDatabase)();
    const userId = getCurrentUserId();
    if (!db || !userId) {
        return [];
    }
    const rows = db.prepare("SELECT payload FROM favorites WHERE id LIKE ? ORDER BY updated_at DESC").all(`${scopeValue("", userId)}%`);
    return rows
        .map((row) => (0, persistence_1.safeJsonParse)(row.payload, {}))
        .filter((item) => Boolean(item.id))
        .filter(canReadStoredWallpaper);
}
// Fast existence check used while decorating engine results.
function isFavorite(id) {
    const db = (0, persistence_1.getDatabase)();
    const scopedId = getScopedValue(id);
    if (!db || !scopedId) {
        return false;
    }
    const favoriteRow = db.prepare("SELECT payload FROM favorites WHERE id = ? LIMIT 1").get(scopedId);
    if (!favoriteRow?.payload) {
        return false;
    }
    const wallpaper = (0, persistence_1.safeJsonParse)(favoriteRow.payload, null);
    return Boolean(wallpaper?.id && canReadStoredWallpaper(wallpaper));
}
// Preferences are generic on purpose because settings will grow over time.
// Preferences are JSON so we can store strings, booleans, arrays, or future small objects.
function savePreference(key, value) {
    const db = (0, persistence_1.getDatabase)();
    const scopedKey = getScopedValue(key);
    if (!db || !scopedKey) {
        return;
    }
    db.prepare(`
    INSERT INTO preferences (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(scopedKey, JSON.stringify(value), getNow());
}
// Generic getter keeps storage flexible without forcing a rigid settings schema too early.
function getPreference(key) {
    const db = (0, persistence_1.getDatabase)();
    const scopedKey = getScopedValue(key);
    if (!db || !scopedKey) {
        return undefined;
    }
    const row = db.prepare("SELECT value FROM preferences WHERE key = ?").get(scopedKey);
    return row ? (0, persistence_1.safeJsonParse)(row.value, undefined) : undefined;
}
// Download history is tracked separately from favorites because those user intents are different.
function getDownloadHistory() {
    const db = (0, persistence_1.getDatabase)();
    const userId = getCurrentUserId();
    if (!db || !userId) {
        return [];
    }
    const rows = db.prepare("SELECT payload FROM download_history WHERE id LIKE ? ORDER BY downloaded_at DESC").all(`${scopeValue("", userId)}%`);
    return rows
        .map((row) => (0, persistence_1.safeJsonParse)(row.payload, {}))
        .filter((item) => Boolean(item.id))
        .filter(canReadStoredWallpaper);
}
// We stamp the download time here so callers do not need to remember to do it.
// Download history keeps the decorated wallpaper object, including download time.
function addToDownloadHistory(wallpaper) {
    const db = (0, persistence_1.getDatabase)();
    const scopedId = getScopedValue(wallpaper.id);
    if (!db || !scopedId) {
        return;
    }
    const downloadedAt = getNow();
    const payload = JSON.stringify({
        ...wallpaper,
        downloadedAt
    });
    db.prepare(`
    INSERT INTO download_history (id, payload, downloaded_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      downloaded_at = excluded.downloaded_at
  `).run(scopedId, payload, downloadedAt);
}
// Search history helps build future UI features like recent searches and smarter suggestions.
// We keep search history deduped and capped so it stays useful instead of noisy.
function addSearchHistory(query) {
    const db = (0, persistence_1.getDatabase)();
    const userId = getCurrentUserId();
    const normalized = query.trim();
    if (!db || !normalized || !userId) {
        return;
    }
    const scopedQuery = scopeValue(normalized, userId);
    const scopedPrefix = `${scopeValue("", userId)}%`;
    const now = getNow();
    db.prepare("DELETE FROM search_history WHERE query = ?").run(scopedQuery);
    db.prepare("INSERT INTO search_history (query, created_at) VALUES (?, ?)").run(scopedQuery, now);
    db.prepare(`
    DELETE FROM search_history
    WHERE query LIKE ?
      AND id NOT IN (
      SELECT id
      FROM search_history
      WHERE query LIKE ?
      ORDER BY created_at DESC
      LIMIT 25
    )
  `).run(scopedPrefix, scopedPrefix);
}
// Returns a safe copy so outside code cannot mutate internal state accidentally.
function getSearchHistory() {
    const db = (0, persistence_1.getDatabase)();
    const userId = getCurrentUserId();
    if (!db || !userId) {
        return [];
    }
    const rows = db.prepare("SELECT query FROM search_history WHERE query LIKE ? ORDER BY created_at DESC").all(`${scopeValue("", userId)}%`);
    return rows.map((row) => stripScopePrefix(row.query, userId));
}
// This is a placeholder for future monetization logic.
// Subscription state is deliberately simple for now because billing is not implemented yet.
function setSubscriptionState(state) {
    writeAppState(getScopedAppStateKey("subscriptionState"), state);
}
function getSubscriptionState() {
    return readAppState(getScopedAppStateKey("subscriptionState"), "free");
}
// Lets the app know whether it should show first-run onboarding behavior once.
// The first-launch flag flips after the first read.
function consumeFirstLaunch() {
    const key = getScopedAppStateKey("firstLaunch");
    const firstLaunch = readAppState(key, true);
    writeAppState(key, false);
    return firstLaunch;
}
// Test helper so the backend suite can start from a known persistent storage state.
// Test helper: wipe user-state tables without touching the request cache or local image bundle.
function storageClear() {
    const db = (0, persistence_1.getDatabase)();
    if (!db) {
        return;
    }
    db.prepare("DELETE FROM favorites").run();
    db.prepare("DELETE FROM preferences").run();
    db.prepare("DELETE FROM download_history").run();
    db.prepare("DELETE FROM search_history").run();
    db.prepare("DELETE FROM app_state").run();
}
