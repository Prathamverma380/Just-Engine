// This file is the brain of the engine.
// Keys, limits, categories, defaults, routing preferences, and feature switches live here.
import {
  type QuotaLimits,
  type RemoteWallpaperSource,
  type WallpaperCategory
} from "../types/wallpaper";

// `require` is used here deliberately so the backend can read `.env.local`
// without adding a dotenv dependency to this lightweight engine.
declare function require(name: string): any;

declare const process:
  | {
      cwd?: () => string;
      env?: Record<string, string | undefined>;
    }
  | undefined;

// Read the local env file by hand so the backend works even outside a framework runtime.
function readDotEnvFile(): Record<string, string> {
  if (typeof process === "undefined" || typeof require === "undefined" || typeof process.cwd !== "function") {
    return {};
  }

  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(process.cwd(), ".env.local");

    if (!fs.existsSync(envPath)) {
      return {};
    }

    const contents = fs.readFileSync(envPath, "utf8");
    const pairs = contents.split(/\r?\n/);
    const parsed: Record<string, string> = {};

    for (const line of pairs) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      parsed[key] = value;
    }

    return parsed;
  } catch {
    return {};
  }
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const fileEnv = readDotEnvFile();
// Runtime env vars win, but `.env.local` gives the backend a working default setup.
const env = typeof process === "undefined" ? fileEnv : { ...fileEnv, ...(process.env ?? {}) };

// All provider credentials are centralized here so the rest of the code never touches raw env access.
// These are the public knobs the rest of the backend reads.
// Keeping them centralized makes future changes safer and easier to reason about.
export const API_KEYS = {
  unsplash: env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY ?? "",
  pexels: env.NEXT_PUBLIC_PEXELS_API_KEY ?? "",
  pixabay: env.NEXT_PUBLIC_PIXABAY_API_KEY ?? "",
  nasa: env.NEXT_PUBLIC_NASA_API_KEY ?? "DEMO_KEY"
} as const;

// These switches let us change engine behavior later without rewriting call sites.
// Feature flags let us change behavior without rewriting call sites.
export const FEATURE_FLAGS = {
  allowStaleCache: true,
  enableOfflineBundle: true,
  preferPortrait: true,
  includePicsumFallback: true,
  enableAiGeneration: readBoolean(env.AI_IMAGE_ENABLED, true),
  enableAutoPromptDetection: readBoolean(env.AI_IMAGE_AUTO_DETECT, true)
} as const;

// Sensible request defaults keep all clients aligned.
// Shared request defaults keep every client speaking roughly the same language.
export const REQUEST_DEFAULTS = {
  perPage: 15,
  maxPerPage: 30,
  requestTimeoutMs: 8000,
  retryAttempts: 2
} as const;

// Cache windows are intentionally long because this product benefits from being aggressively cache-first.
// Cache defaults are long on purpose because cache is a major product feature, not just an optimization.
export const CACHE_SETTINGS = {
  ttlMs: 1000 * 60 * 60 * 24,
  staleTtlMs: 1000 * 60 * 60 * 48,
  maxEntries: 500,
  prefetchCategories: ["nature", "abstract", "space", "dark"] as string[]
} as const;

// These are the quota envelopes the router and tracker work against.
// These limits are for free-tier source budgets.
export const SOURCE_LIMITS: Record<RemoteWallpaperSource, QuotaLimits> = {
  unsplash: {
    hourly: 50,
    monthly: 5000,
    reserveRatio: 0.2,
    requiresKey: true
  },
  pexels: {
    hourly: 200,
    monthly: 20000,
    reserveRatio: 0.2,
    requiresKey: true
  },
  pixabay: {
    minute: 100,
    monthly: 100000,
    reserveRatio: 0.1,
    requiresKey: true
  },
  nasa: {
    hourly: 1000,
    monthly: 720000,
    reserveRatio: 0.1,
    requiresKey: false
  },
  picsum: {
    hourly: Number.POSITIVE_INFINITY,
    monthly: Number.POSITIVE_INFINITY,
    reserveRatio: 0,
    requiresKey: false
  }
};

// This is the heart of category-aware routing.
// The first source in each list is the preferred provider for that content style.
// Category routing preferences are opinionated on purpose.
// The engine is supposed to choose "the most likely best source", not behave randomly.
export const CATEGORY_SOURCE_PRIORITY: Record<string, RemoteWallpaperSource[]> = {
  all: ["unsplash", "pexels", "pixabay", "nasa", "picsum"],
  nature: ["unsplash", "pexels", "pixabay", "picsum", "nasa"],
  abstract: ["pexels", "unsplash", "pixabay", "picsum", "nasa"],
  space: ["unsplash", "pexels", "nasa", "pixabay", "picsum"],
  dark: ["pexels", "unsplash", "pixabay", "picsum", "nasa"],
  minimal: ["pexels", "unsplash", "pixabay", "picsum", "nasa"],
  city: ["unsplash", "pexels", "pixabay", "picsum", "nasa"],
  animals: ["unsplash", "pexels", "pixabay", "picsum", "nasa"],
  illustration: ["pixabay", "pexels", "unsplash", "picsum", "nasa"],
  gradient: ["pexels", "pixabay", "unsplash", "picsum", "nasa"],
  seasonal: ["pexels", "unsplash", "pixabay", "picsum", "nasa"]
};

// When the user browses by category without typing a query, these are the default searches we use.
// These search phrases turn simple category browsing into real provider queries.
export const CATEGORY_QUERIES: Record<WallpaperCategory, string> = {
  all: "wallpaper",
  nature: "nature wallpaper",
  abstract: "abstract wallpaper",
  space: "nebula wallpaper",
  dark: "dark amoled wallpaper",
  minimal: "minimal wallpaper",
  city: "city wallpaper",
  animals: "animal wallpaper",
  illustration: "illustration wallpaper",
  gradient: "gradient wallpaper",
  seasonal: "seasonal wallpaper"
};

// Featured browsing rotates through a small curated theme set so the homepage feels intentional.
// Featured is a light curated rotation for now.
export const FEATURED_ROTATION = [
  { query: "cinematic nature wallpaper", category: "nature" },
  { query: "minimal dark wallpaper", category: "dark" },
  { query: "cosmic nebula wallpaper", category: "space" },
  { query: "abstract fluid art wallpaper", category: "abstract" },
  { query: "night city wallpaper", category: "city" }
] as const;

// These keywords help the router infer a category when the user only enters a free-form query.
// Keywords help us infer user intent from loose text.
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  nature: ["nature", "forest", "mountain", "ocean", "sunset", "river", "landscape"],
  abstract: ["abstract", "pattern", "shape", "geometry", "fluid", "art"],
  space: ["space", "galaxy", "nebula", "planet", "cosmos", "astronomy", "nasa"],
  dark: ["dark", "amoled", "black", "night"],
  minimal: ["minimal", "clean", "simple"],
  city: ["city", "urban", "architecture", "street", "skyline"],
  animals: ["animal", "wildlife", "cat", "dog", "bird", "tiger"],
  illustration: ["illustration", "drawing", "digital art", "vector", "anime"],
  gradient: ["gradient", "color blend", "mesh"],
  seasonal: ["christmas", "winter", "autumn", "fall", "summer", "spring", "holiday"]
};

// Shared keys used across the engine so we do not repeat magic strings.
// Shared cache keys and fixed identifiers belong here, not scattered around the codebase.
export const ENGINE_CONSTANTS = {
  dailyCacheKey: "daily:space:1",
  featuredCacheKey: "featured:all:1"
} as const;

// This answers the simple question: "can we even try this source right now?"
export function isSourceConfigured(source: RemoteWallpaperSource): boolean {
  if (source === "picsum" || source === "nasa") {
    return true;
  }

  const key = API_KEYS[source];
  return typeof key === "string" && key.trim().length > 0;
}

export { AI_PROVIDER_LIMITS, AI_PROVIDER_SETTINGS, AI_SETTINGS, AI_STORAGE_SETTINGS } from "../ai/config";
