import type { SupabaseAuthConfig } from "./types";

declare function require(name: string): any;
declare const process:
  | {
      cwd?: () => string;
      env?: Record<string, string | undefined>;
    }
  | undefined;

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

    const parsed: Record<string, string> = {};
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

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      parsed[key] = value;
    }

    return parsed;
  } catch {
    return {};
  }
}

function readEnvValue(
  env: Record<string, string | undefined>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

export function getSupabaseAuthConfig(overrides: Partial<SupabaseAuthConfig> = {}): SupabaseAuthConfig {
  const fileEnv = readDotEnvFile();
  const env = typeof process === "undefined" ? fileEnv : { ...fileEnv, ...(process.env ?? {}) };
  const url = (overrides.url ?? readEnvValue(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_PROJECT_URL"]))
    .trim()
    .replace(/\/+$/, "");
  const anonKey = (overrides.anonKey ??
    readEnvValue(env, ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLIC_ANON_KEY"]))
    .trim();

  if (!url) {
    throw new Error("Supabase auth is not configured: missing SUPABASE_URL.");
  }

  if (!anonKey) {
    throw new Error("Supabase auth is not configured: missing SUPABASE_ANON_KEY.");
  }

  return {
    url,
    anonKey
  };
}
