import { getAuthSession, getAuthenticatedSession } from "../auth";
import { getSupabaseAuthConfig } from "../auth/config";
import type { SupabaseSession, SupabaseUser } from "../auth/types";
import { getDatabase, safeJsonParse } from "../persistence";

declare function require(name: string): any;
declare const process:
  | {
      cwd?: () => string;
      env?: Record<string, string | undefined>;
    }
  | undefined;

export type ViewerPlan = "free" | "premium";
export type ViewerEntitlementStatus = "active" | "trialing" | "canceled" | "expired" | "inactive";
export type AccessControlErrorCode = "authentication_required" | "subscription_required";

export interface ViewerEntitlement {
  userId: string;
  plan: ViewerPlan;
  status: ViewerEntitlementStatus;
  source: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string | null;
}

export interface ViewerAccessContext {
  session: SupabaseSession;
  user: SupabaseUser;
  entitlement: ViewerEntitlement;
}

type ViewerAccessOverride =
  | {
      session: SupabaseSession | null;
      entitlement?: Partial<ViewerEntitlement>;
    }
  | null;

const ENTITLEMENT_CACHE_KEY_PREFIX = "access.entitlement.";

let viewerAccessOverrideForTests: ViewerAccessOverride = null;

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

function getEntitlementsTableName(): string {
  const fileEnv = readDotEnvFile();
  const env = typeof process === "undefined" ? fileEnv : { ...fileEnv, ...(process.env ?? {}) };
  return env.SUPABASE_ENTITLEMENTS_TABLE?.trim() || "user_entitlements";
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildRestTableUrl(baseUrl: string, tableName: string): string {
  return `${baseUrl}/rest/v1/${encodePathSegment(tableName)}`;
}

function isViewerPlan(value: unknown): value is ViewerPlan {
  return value === "free" || value === "premium";
}

function isViewerEntitlementStatus(value: unknown): value is ViewerEntitlementStatus {
  return value === "active" || value === "trialing" || value === "canceled" || value === "expired" || value === "inactive";
}

function buildDefaultEntitlement(userId: string): ViewerEntitlement {
  return {
    userId,
    plan: "free",
    status: "active",
    source: "default",
    currentPeriodEnd: null,
    updatedAt: null
  };
}

function normalizeEntitlement(value: Record<string, unknown> | null | undefined, userId: string): ViewerEntitlement {
  if (!value) {
    return buildDefaultEntitlement(userId);
  }

  const plan = isViewerPlan(value.plan) ? value.plan : "free";
  const status = isViewerEntitlementStatus(value.status) ? value.status : "active";
  const source = typeof value.source === "string" && value.source.trim() ? value.source.trim() : null;
  const currentPeriodEnd =
    typeof value.current_period_end === "string" && value.current_period_end.trim()
      ? value.current_period_end.trim()
      : typeof value.currentPeriodEnd === "string" && value.currentPeriodEnd.trim()
        ? value.currentPeriodEnd.trim()
        : null;
  const updatedAt =
    typeof value.updated_at === "string" && value.updated_at.trim()
      ? value.updated_at.trim()
      : typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : null;

  return {
    userId,
    plan,
    status,
    source,
    currentPeriodEnd,
    updatedAt
  };
}

function cacheEntitlement(entitlement: ViewerEntitlement): void {
  const db = getDatabase();
  if (!db) {
    return;
  }

  const key = `${ENTITLEMENT_CACHE_KEY_PREFIX}${entitlement.userId}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(entitlement), now);
}

export function getCachedViewerEntitlement(userId?: string): ViewerEntitlement | null {
  const resolvedUserId = userId?.trim() || getAuthSession()?.user.id || "";
  if (!resolvedUserId) {
    return null;
  }

  const db = getDatabase();
  if (!db) {
    return null;
  }

  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(
    `${ENTITLEMENT_CACHE_KEY_PREFIX}${resolvedUserId}`
  ) as
    | {
        value: string;
      }
    | undefined;

  return row?.value ? safeJsonParse<ViewerEntitlement | null>(row.value, null) : null;
}

export function isPremiumEntitlement(entitlement: ViewerEntitlement | null | undefined): boolean {
  if (!entitlement || entitlement.plan !== "premium") {
    return false;
  }

  return entitlement.status === "active" || entitlement.status === "trialing";
}

async function fetchViewerEntitlement(userId: string, accessToken: string): Promise<ViewerEntitlement> {
  const config = getSupabaseAuthConfig();
  const response = await fetch(
    `${buildRestTableUrl(config.url, getEntitlementsTableName())}?user_id=eq.${encodeURIComponent(userId)}&select=user_id,plan,status,current_period_end,source,updated_at&limit=1`,
    {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Supabase entitlement lookup failed with HTTP ${response.status}${body ? ` :: ${body}` : ""}`
    );
  }

  const rows = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;
  return normalizeEntitlement(rows[0] ?? null, userId);
}

export class AccessControlError extends Error {
  readonly code: AccessControlErrorCode;
  readonly status: number;

  constructor(code: AccessControlErrorCode, message?: string) {
    super(
      message ??
        (code === "authentication_required"
          ? "Authentication is required."
          : "An active premium subscription is required.")
    );
    this.name = "AccessControlError";
    this.code = code;
    this.status = code === "authentication_required" ? 401 : 403;
  }
}

export function setViewerAccessOverrideForTests(override: ViewerAccessOverride): void {
  viewerAccessOverrideForTests = override;

  if (override?.session?.user.id) {
    cacheEntitlement(normalizeEntitlement(override.entitlement ?? null, override.session.user.id));
  }
}

async function resolveViewerAccess(requirePremium: boolean): Promise<ViewerAccessContext> {
  if (viewerAccessOverrideForTests) {
    const session = viewerAccessOverrideForTests.session;
    if (!session) {
      throw new AccessControlError("authentication_required", "authentication_required");
    }

    const entitlement = normalizeEntitlement(viewerAccessOverrideForTests.entitlement ?? null, session.user.id);
    cacheEntitlement(entitlement);

    if (requirePremium && !isPremiumEntitlement(entitlement)) {
      throw new AccessControlError("subscription_required", "subscription_required");
    }

    return {
      session,
      user: session.user,
      entitlement
    };
  }

  const session = await getAuthenticatedSession({
    refreshIfExpired: true
  });

  if (!session) {
    throw new AccessControlError("authentication_required", "authentication_required");
  }

  const entitlement = await fetchViewerEntitlement(session.user.id, session.accessToken);
  cacheEntitlement(entitlement);

  if (requirePremium && !isPremiumEntitlement(entitlement)) {
    throw new AccessControlError("subscription_required", "subscription_required");
  }

  return {
    session,
    user: session.user,
    entitlement
  };
}

export async function requireAuthenticatedViewer(): Promise<ViewerAccessContext> {
  return resolveViewerAccess(false);
}

export async function requirePremiumViewer(): Promise<ViewerAccessContext> {
  return resolveViewerAccess(true);
}
