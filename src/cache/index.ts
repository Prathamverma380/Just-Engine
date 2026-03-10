// This file has two jobs:
// 1. store exact request results
// 2. maintain the searchable local bundle that grows from fetched wallpapers
import { CACHE_SETTINGS } from "../config";
import { getDatabase, safeJsonParse } from "../persistence";
import type { CacheEntry, CacheLookupResult, CacheStats, Wallpaper } from "../types/wallpaper";

// This in-memory LRU-like map is the first line of defense against unnecessary API calls.
// The in-memory layer is the fastest path.
// The SQLite layer is the durable path.
const cacheStore = new Map<string, CacheEntry<Wallpaper[]>>();

// Basic counters power health/stats and help us reason about whether the cache is actually doing useful work.
let hits = 0;
let misses = 0;
let staleHits = 0;
let writes = 0;

// When an item is read, we move it to the back so old unused entries get evicted first.
// Updates recency so the oldest unused entries are the ones that get pushed out first.
function touchEntry(entry: CacheEntry<Wallpaper[]>): void {
  cacheStore.delete(entry.key);
  entry.lastAccessedAt = Date.now();
  cacheStore.set(entry.key, entry);
}

// Keeps the cache bounded so it stays fast and predictable.
// Keeps both memory cache and SQLite request cache from growing forever.
function evictIfNeeded(): void {
  while (cacheStore.size > CACHE_SETTINGS.maxEntries) {
    const oldestKey = cacheStore.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }

    cacheStore.delete(oldestKey);
  }

  const db = getDatabase();
  if (db) {
    db.prepare(`
      DELETE FROM cache_entries
      WHERE key NOT IN (
        SELECT key
        FROM cache_entries
        ORDER BY last_accessed_at DESC
        LIMIT ?
      )
    `).run(CACHE_SETTINGS.maxEntries);
  }
}

// A stable cache key means identical requests collapse into the same stored result.
export function generateCacheKey(query: string, category: string, page: number, mode = "search"): string {
  return `${mode}:${query.trim().toLowerCase() || "all"}:${category.trim().toLowerCase() || "all"}:${page}`;
}

// Reads prefer fresh data, but can optionally serve stale results during provider outages.
// First try memory. If memory missed, hydrate from SQLite.
export function cacheGet(
  key: string,
  options: { allowStale?: boolean } = {}
): CacheLookupResult<Wallpaper[]> | null {
  let entry = cacheStore.get(key);

  if (!entry) {
    const db = getDatabase();
    // Pulling from SQLite here means a restart does not erase useful request results.
    const row = db?.prepare(`
      SELECT key, payload, created_at, expires_at, stale_at, last_accessed_at
      FROM cache_entries
      WHERE key = ?
    `).get(key) as
      | {
          key: string;
          payload: string;
          created_at: number;
          expires_at: number;
          stale_at: number;
          last_accessed_at: number;
        }
      | undefined;

    if (row) {
      entry = {
        key: row.key,
        data: safeJsonParse<Wallpaper[]>(row.payload, []),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        staleAt: row.stale_at,
        lastAccessedAt: row.last_accessed_at
      };
      cacheStore.set(key, entry);
    }
  }

  if (!entry) {
    misses += 1;
    return null;
  }

  const now = Date.now();
  const isFresh = entry.expiresAt > now;
  const isStillStale = entry.staleAt > now;
  const isStaleButAllowed = options.allowStale && entry.staleAt > now;

  // Truly dead entries are removed completely.
  if (!isFresh && !isStillStale) {
    cacheStore.delete(key);
    const db = getDatabase();
    db?.prepare("DELETE FROM cache_entries WHERE key = ?").run(key);
    misses += 1;
    return null;
  }

  // Expired-but-still-stale entries stay stored so outage fallback can still use them later.
  if (!isFresh && !isStaleButAllowed) {
    misses += 1;
    return null;
  }

  touchEntry(entry);
  const db = getDatabase();
  db?.prepare("UPDATE cache_entries SET last_accessed_at = ? WHERE key = ?").run(entry.lastAccessedAt, key);

  if (isFresh) {
    hits += 1;
    return {
      data: entry.data,
      state: "fresh"
    };
  }

  staleHits += 1;
  return {
    data: entry.data,
    state: "stale"
  };
}

// Writes store both normal TTL and stale-fallback TTL in one shot.
// Every request-cache write is mirrored into SQLite.
export function cacheSet(
  key: string,
  data: Wallpaper[],
  ttlMs = CACHE_SETTINGS.ttlMs,
  staleTtlMs = CACHE_SETTINGS.staleTtlMs
): void {
  const now = Date.now();
  cacheStore.set(key, {
    key,
    data,
    createdAt: now,
    expiresAt: now + ttlMs,
    staleAt: now + staleTtlMs,
    lastAccessedAt: now
  });
  const db = getDatabase();
  db?.prepare(`
    INSERT INTO cache_entries (key, payload, created_at, expires_at, stale_at, last_accessed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      payload = excluded.payload,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      stale_at = excluded.stale_at,
      last_accessed_at = excluded.last_accessed_at
  `).run(key, JSON.stringify(data), now, now + ttlMs, now + staleTtlMs, now);
  writes += 1;
  evictIfNeeded();
}

// Convenience helper used by routing and health logic.
export function cacheHas(key: string): boolean {
  return cacheGet(key) !== null;
}

// Used mainly by tests so they can start from a clean state.
export function cacheClear(): void {
  cacheStore.clear();
  const db = getDatabase();
  db?.prepare("DELETE FROM cache_entries").run();
  hits = 0;
  misses = 0;
  staleHits = 0;
  writes = 0;
}

// Clears only the process memory layer so tests can prove data survives on disk.
export function cacheResetMemory(): void {
  cacheStore.clear();
}

// The local bundle index is different from exact request caching:
// it stores individual wallpapers in a searchable library.
function buildSearchText(wallpaper: Wallpaper): string {
  return [
    wallpaper.category,
    wallpaper.metadata.description,
    wallpaper.photographer.name,
    ...wallpaper.metadata.tags
  ]
    .join(" ")
    .toLowerCase();
}

// Persists normalized wallpapers into the local SQLite bundle so future searches can be served locally.
// Any normalized wallpaper can be indexed here so later searches can be answered locally.
export function localBundleUpsert(wallpapers: Wallpaper[]): void {
  const db = getDatabase();
  if (!db || wallpapers.length === 0) {
    return;
  }

  const statement = db.prepare(`
    INSERT INTO local_bundle (id, source, source_id, category, payload, search_text, cached_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source = excluded.source,
      source_id = excluded.source_id,
      category = excluded.category,
      payload = excluded.payload,
      search_text = excluded.search_text,
      cached_at = excluded.cached_at,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  for (const wallpaper of wallpapers) {
    statement.run(
      wallpaper.id,
      wallpaper.source,
      wallpaper.sourceId,
      wallpaper.category.toLowerCase(),
      JSON.stringify(wallpaper),
      buildSearchText(wallpaper),
      wallpaper.cachedAt,
      now
    );
  }
}

// Searches the persisted local image bundle before we spend any remote API quota.
// This is intentionally simple scoring:
// category filter first, then token matches, then recency.
export function localBundleSearch(
  query: string,
  category: string,
  page: number,
  perPage: number
): Wallpaper[] {
  const db = getDatabase();
  if (!db) {
    return [];
  }

  const normalizedCategory = category.trim().toLowerCase() || "all";
  const normalizedQuery = query.trim().toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const rows = db.prepare(`
    SELECT payload
    FROM local_bundle
    WHERE (? = 'all' OR category = ?)
    ORDER BY updated_at DESC
    LIMIT 500
  `).all(normalizedCategory, normalizedCategory) as Array<{
    payload: string;
  }>;

  const candidates = rows
    .map((row) => safeJsonParse<Wallpaper | null>(row.payload, null))
    .filter((item): item is Wallpaper => Boolean(item?.id));

  const scored = candidates
    .map((wallpaper) => {
      const haystack = buildSearchText(wallpaper);
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

  const start = Math.max(0, (page - 1) * perPage);
  return scored.slice(start, start + perPage).map((entry) => entry.wallpaper);
}

// Test/helper utility for resetting the local bundle index without touching exact request cache.
// Separate helper so tests can reset the local library cleanly.
export function localBundleClear(): void {
  const db = getDatabase();
  db?.prepare("DELETE FROM local_bundle").run();
}

// Exposes operational cache numbers without leaking internal storage details.
// Stats blend both the memory view and the persisted view into one operator-friendly summary.
export function cacheStats(): CacheStats {
  const totalReads = hits + misses + staleHits;
  const db = getDatabase();
  const oldestRow = db?.prepare("SELECT MIN(created_at) AS oldest FROM cache_entries").get() as
    | {
        oldest: number | null;
      }
    | undefined;
  const oldestEntry = Array.from(cacheStore.values()).reduce<number | null>((oldest, entry) => {
    if (oldest === null) {
      return entry.createdAt;
    }

    return Math.min(oldest, entry.createdAt);
  }, oldestRow?.oldest ?? null);

  return {
    size:
      (db?.prepare("SELECT COUNT(*) AS count FROM cache_entries").get() as { count: number } | undefined)?.count ??
      cacheStore.size,
    hits,
    misses,
    staleHits,
    writes,
    hitRate: totalReads === 0 ? 0 : Number(((hits + staleHits) / totalReads).toFixed(2)),
    oldestEntry
  };
}
