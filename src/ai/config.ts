import type { ImageIntent } from "../types/wallpaper";
import type { AiProviderName, AiProviderSettings, AiQuotaLimits } from "./types";

// AI runtime configuration.
// This file centralizes all AI env parsing so provider modules and the wrapper never
// read raw environment variables directly.
declare function require(name: string): any;
declare const process:
  | {
      cwd?: () => string;
      env?: Record<string, string | undefined>;
    }
  | undefined;

// Reads `.env.local` directly so the backend still works outside a framework runtime.
// This mirrors the pattern used elsewhere in the project.
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
    const parsed: Record<string, string> = {};

    for (const line of contents.split(/\r?\n/)) {
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

// Generic boolean env parser used for feature switches and enable flags.
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

// Numeric parser for positive integer settings like timeouts or max-image counts.
function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Quota windows may be omitted or explicitly described as unlimited.
// This helper normalizes those values before they enter the quota module.
function readQuotaValue(value: string | undefined): number | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "infinite" || normalized === "unlimited") {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Keeps `auto/search/generate` parsing in one place.
function readImageIntent(value: string | undefined, fallback: ImageIntent): ImageIntent {
  const normalized = value?.trim().toLowerCase();
  return normalized === "search" || normalized === "generate" || normalized === "auto" ? normalized : fallback;
}

// Several env names may map to the same setting.
// This helper picks the first configured value from an ordered key list.
function readFirstValue(env: Record<string, string | undefined>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

// Guard for provider names coming from env configuration.
function isAiProviderName(value: string): value is AiProviderName {
  return value === "openai" || value === "nano_banana" || value === "eleven_labs";
}

// Parses the preferred primary provider from env.
function readProvider(value: string | undefined, fallback: AiProviderName): AiProviderName {
  const normalized = value?.trim().toLowerCase();
  return normalized && isAiProviderName(normalized) ? normalized : fallback;
}

// Parses a comma-separated fallback chain like `openai,nano_banana,eleven_labs`.
// Duplicates are removed later so the chain stays deterministic and clean.
function readProviderList(
  value: string | undefined,
  fallback: AiProviderName[]
): AiProviderName[] {
  if (!value?.trim()) {
    return [...fallback];
  }

  const items = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AiProviderName => isAiProviderName(item));

  return items.length > 0 ? Array.from(new Set(items)) : [...fallback];
}

// Builds one provider config object from a set of env keys plus repo defaults.
// This keeps OpenAI, Nano Banana, and ElevenLabs definitions uniform.
function buildProviderSettings(
  env: Record<string, string | undefined>,
  input: {
    enabledKeys: string[];
    apiKeyKeys: string[];
    apiUrlKeys: string[];
    modelKeys: string[];
    sizeKeys: string[];
    qualityKeys: string[];
    styleKeys: string[];
    timeoutKeys: string[];
    fallbackApiUrl: string;
    fallbackModel: string;
    fallbackSize: string;
    fallbackQuality: string;
    fallbackStyle: string;
  }
): AiProviderSettings {
  return {
    enabled: readBoolean(readFirstValue(env, input.enabledKeys), true),
    apiKey: readFirstValue(env, input.apiKeyKeys),
    apiUrl: readFirstValue(env, input.apiUrlKeys) || input.fallbackApiUrl,
    defaultModel: readFirstValue(env, input.modelKeys) || input.fallbackModel,
    defaultSize: readFirstValue(env, input.sizeKeys) || input.fallbackSize,
    defaultQuality: readFirstValue(env, input.qualityKeys) || input.fallbackQuality,
    defaultStyle: readFirstValue(env, input.styleKeys) || input.fallbackStyle,
    timeoutMs: readPositiveInteger(readFirstValue(env, input.timeoutKeys), 30000)
  };
}

// Builds the static reserve-based quota envelope for one provider.
// Runtime observed rate-limit headers can later refine this picture.
function buildQuotaLimits(
  env: Record<string, string | undefined>,
  prefix: string,
  requiresKey: boolean,
  reserveRatio: number
): AiQuotaLimits {
  const minute = readQuotaValue(env[`${prefix}_MINUTE_LIMIT`]);
  const hourly = readQuotaValue(env[`${prefix}_HOURLY_LIMIT`]);
  const daily = readQuotaValue(env[`${prefix}_DAILY_LIMIT`]);
  const monthly = readQuotaValue(env[`${prefix}_MONTHLY_LIMIT`]);

  return {
    ...(minute !== undefined ? { minute } : {}),
    ...(hourly !== undefined ? { hourly } : {}),
    ...(daily !== undefined ? { daily } : {}),
    ...(monthly !== undefined ? { monthly } : {}),
    reserveRatio,
    requiresKey
  };
}

// Runtime env wins over `.env.local`, but both feed the same normalized config.
const fileEnv = readDotEnvFile();
const env = typeof process === "undefined" ? fileEnv : { ...fileEnv, ...(process.env ?? {}) };
const fallbackChain = readProviderList(env.AI_IMAGE_PROVIDER_CHAIN, ["openai", "nano_banana", "eleven_labs"]);
const defaultProvider = readProvider(env.AI_IMAGE_PRIMARY_PROVIDER, fallbackChain[0] ?? "openai");

// Provider-by-provider API settings.
// Adapters read from this map instead of touching env parsing directly.
export const AI_PROVIDER_SETTINGS: Record<AiProviderName, AiProviderSettings> = {
  openai: buildProviderSettings(env, {
    enabledKeys: ["OPENAI_IMAGE_ENABLED", "AI_IMAGE_OPENAI_ENABLED", "AI_IMAGE_ENABLED"],
    apiKeyKeys: ["OPENAI_API_KEY", "OPENAI_IMAGE_API_KEY", "AI_IMAGE_OPENAI_API_KEY", "AI_IMAGE_API_KEY"],
    apiUrlKeys: ["OPENAI_IMAGE_API_URL", "AI_IMAGE_OPENAI_API_URL", "AI_IMAGE_API_URL"],
    modelKeys: ["OPENAI_IMAGE_MODEL", "AI_IMAGE_OPENAI_MODEL", "AI_IMAGE_MODEL"],
    sizeKeys: ["OPENAI_IMAGE_SIZE", "AI_IMAGE_SIZE"],
    qualityKeys: ["OPENAI_IMAGE_QUALITY", "AI_IMAGE_QUALITY"],
    styleKeys: ["OPENAI_IMAGE_STYLE", "AI_IMAGE_STYLE"],
    timeoutKeys: ["OPENAI_IMAGE_TIMEOUT_MS", "AI_IMAGE_TIMEOUT_MS"],
    fallbackApiUrl: "https://api.openai.com/v1/images/generations",
    fallbackModel: "gpt-image-1",
    fallbackSize: "1024x1536",
    fallbackQuality: "high",
    fallbackStyle: "vivid"
  }),
  nano_banana: buildProviderSettings(env, {
    enabledKeys: ["NANO_BANANA_ENABLED", "GEMINI_IMAGE_ENABLED", "AI_IMAGE_ENABLED"],
    apiKeyKeys: ["GEMINI_API_KEY", "NANO_BANANA_API_KEY"],
    apiUrlKeys: ["NANO_BANANA_API_URL", "GEMINI_API_URL"],
    modelKeys: ["NANO_BANANA_MODEL", "GEMINI_IMAGE_MODEL"],
    sizeKeys: ["NANO_BANANA_SIZE", "GEMINI_IMAGE_SIZE", "AI_IMAGE_SIZE"],
    qualityKeys: ["NANO_BANANA_QUALITY", "GEMINI_IMAGE_QUALITY", "AI_IMAGE_QUALITY"],
    styleKeys: ["NANO_BANANA_STYLE", "GEMINI_IMAGE_STYLE", "AI_IMAGE_STYLE"],
    timeoutKeys: ["NANO_BANANA_TIMEOUT_MS", "GEMINI_IMAGE_TIMEOUT_MS", "AI_IMAGE_TIMEOUT_MS"],
    fallbackApiUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    fallbackModel: "gemini-2.5-flash-image",
    fallbackSize: "1024x1536",
    fallbackQuality: "high",
    fallbackStyle: ""
  }),
  eleven_labs: buildProviderSettings(env, {
    enabledKeys: ["ELEVENLABS_IMAGE_ENABLED", "ELEVEN_LABS_IMAGE_ENABLED"],
    apiKeyKeys: ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"],
    apiUrlKeys: ["ELEVENLABS_IMAGE_API_URL", "ELEVEN_LABS_IMAGE_API_URL"],
    modelKeys: ["ELEVENLABS_IMAGE_MODEL", "ELEVEN_LABS_IMAGE_MODEL"],
    sizeKeys: ["ELEVENLABS_IMAGE_SIZE", "ELEVEN_LABS_IMAGE_SIZE", "AI_IMAGE_SIZE"],
    qualityKeys: ["ELEVENLABS_IMAGE_QUALITY", "ELEVEN_LABS_IMAGE_QUALITY", "AI_IMAGE_QUALITY"],
    styleKeys: ["ELEVENLABS_IMAGE_STYLE", "ELEVEN_LABS_IMAGE_STYLE", "AI_IMAGE_STYLE"],
    timeoutKeys: ["ELEVENLABS_IMAGE_TIMEOUT_MS", "ELEVEN_LABS_IMAGE_TIMEOUT_MS", "AI_IMAGE_TIMEOUT_MS"],
    fallbackApiUrl: "",
    fallbackModel: "flux-pro",
    fallbackSize: "1024x1536",
    fallbackQuality: "high",
    fallbackStyle: ""
  })
};

// Cross-provider defaults used by the wrapper and engine.
// These describe the desired AI routing behavior of the app as a whole.
export const AI_SETTINGS = {
  defaultProvider,
  fallbackChain,
  defaultModel: AI_PROVIDER_SETTINGS[defaultProvider].defaultModel,
  defaultSize: readFirstValue(env, ["AI_IMAGE_SIZE"]) || "1024x1536",
  defaultQuality: readFirstValue(env, ["AI_IMAGE_QUALITY"]) || "high",
  defaultStyle: readFirstValue(env, ["AI_IMAGE_STYLE"]) || "vivid",
  defaultIntent: readImageIntent(env.AI_IMAGE_DEFAULT_INTENT, "auto"),
  promptWordThreshold: readPositiveInteger(env.AI_IMAGE_PROMPT_WORD_THRESHOLD, 5),
  maxImagesPerRequest: readPositiveInteger(env.AI_IMAGE_MAX_IMAGES_PER_REQUEST, 1)
} as const;

// Static quota envelopes for the AI quota tracker.
export const AI_PROVIDER_LIMITS: Record<AiProviderName, AiQuotaLimits> = {
  openai: buildQuotaLimits(env, "OPENAI_IMAGE", true, 0.1),
  nano_banana: buildQuotaLimits(env, "NANO_BANANA", true, 0.1),
  eleven_labs: buildQuotaLimits(env, "ELEVENLABS_IMAGE", true, 0.1)
};

// Supabase persistence settings for generated content.
// If disabled, generation still works; only storage is skipped.
export const AI_STORAGE_SETTINGS = {
  enabled: readBoolean(env.AI_GENERATION_SUPABASE_ENABLED, false),
  tableName: readFirstValue(env, ["AI_GENERATION_SUPABASE_TABLE"]) || "ai_generated_content",
  bucketName: readFirstValue(env, ["AI_GENERATION_SUPABASE_BUCKET"]),
  serviceRoleKey: readFirstValue(env, ["SUPABASE_SERVICE_ROLE_KEY"]),
  persistDataUrls: readBoolean(env.AI_GENERATION_SUPABASE_PERSIST_DATA_URLS, true),
  bucketIsPublic: readBoolean(env.AI_GENERATION_SUPABASE_BUCKET_PUBLIC, false)
} as const;
