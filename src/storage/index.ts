// This file is the user-state side of persistence.
// It stores what the user cares about, not what the providers returned.
import { getCachedViewerEntitlement, isPremiumEntitlement } from "../access";
import { getAuthSession } from "../auth";
import { getDatabase, safeJsonParse } from "../persistence";
import type { Wallpaper } from "../types/wallpaper";

// Small alias keeps intent clearer in the functions below.
type SubscriptionState = "free" | "premium";

// Centralized timestamp helper so writes are consistent and easy to change later.
function getNow(): number {
  return Date.now();
}

function getCurrentUserId(): string | null {
  return getAuthSession()?.user.id ?? null;
}

function scopeValue(value: string, userId: string): string {
  return `${userId}::${value}`;
}

function getScopedValue(value: string): string | null {
  const userId = getCurrentUserId();
  return userId ? scopeValue(value, userId) : null;
}

function stripScopePrefix(value: string, userId: string): string {
  const prefix = `${userId}::`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function canReadStoredWallpaper(wallpaper: Wallpaper): boolean {
  if (wallpaper.source !== "ai") {
    return true;
  }

  return isPremiumEntitlement(getCachedViewerEntitlement());
}

function getScopedAppStateKey(key: string): string {
  const userId = getCurrentUserId();
  return userId ? scopeValue(key, userId) : key;
}

// Reads a small app-level setting from persistent state.
// This is for tiny app flags like "first launch" and "subscription state".
function readAppState<T>(key: string, fallback: T): T {
  const db = getDatabase();
  if (!db) {
    return fallback;
  }

  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(key) as
    | {
        value: string;
      }
    | undefined;

  return row ? safeJsonParse<T>(row.value, fallback) : fallback;
}

// Writes a small app-level setting into persistent state.
// Matching writer for the generic app-state table.
function writeAppState(key: string, value: unknown): void {
  const db = getDatabase();
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
export function saveFavorite(wallpaper: Wallpaper): void {
  const db = getDatabase();
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
export function removeFavorite(id: string): void {
  const db = getDatabase();
  const scopedId = getScopedValue(id);
  if (!scopedId) {
    return;
  }

  db?.prepare("DELETE FROM favorites WHERE id = ?").run(scopedId);
}

// Favorites come back as fully serialized wallpaper objects.
// Reading favorites means deserializing the full saved wallpapers back out of SQLite.
export function getFavorites(): Wallpaper[] {
  const db = getDatabase();
  const userId = getCurrentUserId();
  if (!db || !userId) {
    return [];
  }

  const rows = db.prepare("SELECT payload FROM favorites WHERE id LIKE ? ORDER BY updated_at DESC").all(
    `${scopeValue("", userId)}%`
  ) as Array<{
    payload: string;
  }>;

  return rows
    .map((row) => safeJsonParse<Wallpaper>(row.payload, {} as Wallpaper))
    .filter((item) => Boolean(item.id))
    .filter(canReadStoredWallpaper);
}

// Fast existence check used while decorating engine results.
export function isFavorite(id: string): boolean {
  const db = getDatabase();
  const scopedId = getScopedValue(id);
  if (!db || !scopedId) {
    return false;
  }

  const favoriteRow = db.prepare("SELECT payload FROM favorites WHERE id = ? LIMIT 1").get(scopedId) as
    | {
        payload: string;
      }
    | undefined;

  if (!favoriteRow?.payload) {
    return false;
  }

  const wallpaper = safeJsonParse<Wallpaper | null>(favoriteRow.payload, null);
  return Boolean(wallpaper?.id && canReadStoredWallpaper(wallpaper));
}

// Preferences are generic on purpose because settings will grow over time.
// Preferences are JSON so we can store strings, booleans, arrays, or future small objects.
export function savePreference(key: string, value: unknown): void {
  const db = getDatabase();
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
export function getPreference<T>(key: string): T | undefined {
  const db = getDatabase();
  const scopedKey = getScopedValue(key);
  if (!db || !scopedKey) {
    return undefined;
  }

  const row = db.prepare("SELECT value FROM preferences WHERE key = ?").get(scopedKey) as
    | {
        value: string;
      }
    | undefined;

  return row ? safeJsonParse<T | undefined>(row.value, undefined) : undefined;
}

// Download history is tracked separately from favorites because those user intents are different.
export function getDownloadHistory(): Wallpaper[] {
  const db = getDatabase();
  const userId = getCurrentUserId();
  if (!db || !userId) {
    return [];
  }

  const rows = db.prepare("SELECT payload FROM download_history WHERE id LIKE ? ORDER BY downloaded_at DESC").all(
    `${scopeValue("", userId)}%`
  ) as Array<{
    payload: string;
  }>;

  return rows
    .map((row) => safeJsonParse<Wallpaper>(row.payload, {} as Wallpaper))
    .filter((item) => Boolean(item.id))
    .filter(canReadStoredWallpaper);
}

// We stamp the download time here so callers do not need to remember to do it.
// Download history keeps the decorated wallpaper object, including download time.
export function addToDownloadHistory(wallpaper: Wallpaper): void {
  const db = getDatabase();
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
export function addSearchHistory(query: string): void {
  const db = getDatabase();
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
export function getSearchHistory(): string[] {
  const db = getDatabase();
  const userId = getCurrentUserId();
  if (!db || !userId) {
    return [];
  }

  const rows = db.prepare("SELECT query FROM search_history WHERE query LIKE ? ORDER BY created_at DESC").all(
    `${scopeValue("", userId)}%`
  ) as Array<{
    query: string;
  }>;

  return rows.map((row) => stripScopePrefix(row.query, userId));
}

// This is a placeholder for future monetization logic.
// Subscription state is deliberately simple for now because billing is not implemented yet.
export function setSubscriptionState(state: SubscriptionState): void {
  writeAppState(getScopedAppStateKey("subscriptionState"), state);
}

export function getSubscriptionState(): SubscriptionState {
  return readAppState<SubscriptionState>(getScopedAppStateKey("subscriptionState"), "free");
}

// Lets the app know whether it should show first-run onboarding behavior once.
// The first-launch flag flips after the first read.
export function consumeFirstLaunch(): boolean {
  const key = getScopedAppStateKey("firstLaunch");
  const firstLaunch = readAppState<boolean>(key, true);
  writeAppState(key, false);
  return firstLaunch;
}

// Test helper so the backend suite can start from a known persistent storage state.
// Test helper: wipe user-state tables without touching the request cache or local image bundle.
export function storageClear(): void {
  const db = getDatabase();
  if (!db) {
    return;
  }

  db.prepare("DELETE FROM favorites").run();
  db.prepare("DELETE FROM preferences").run();
  db.prepare("DELETE FROM download_history").run();
  db.prepare("DELETE FROM search_history").run();
  db.prepare("DELETE FROM app_state").run();
}
