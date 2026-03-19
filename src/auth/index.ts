import { getDatabase, safeJsonParse } from "../persistence";
import { getSupabaseAuthConfig } from "./config";
import type {
  EmailOtpRequest,
  EmailOtpResult,
  SupabaseAuthConfig,
  SupabaseEmailOtpType,
  SupabaseSession,
  SupabaseUser,
  SupabaseUserIdentity,
  VerifyEmailOtpRequest
} from "./types";

type SupabaseRequestInit = {
  method?: "GET" | "POST";
  accessToken?: string | undefined;
  body?: Record<string, unknown> | undefined;
  config?: Partial<SupabaseAuthConfig> | undefined;
};

type SupabaseErrorBody = {
  error?: string;
  error_code?: string;
  error_description?: string;
  msg?: string;
  message?: string;
};

const SESSION_STATE_KEY = "auth.supabase.session";
const EMAIL_VERIFY_FALLBACK_ORDER: readonly SupabaseEmailOtpType[] = ["email", "signup", "magiclink"];
let memorySession: SupabaseSession | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getOptionalRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function normalizeIdentity(value: unknown): SupabaseUserIdentity | null {
  if (!isObject(value)) {
    return null;
  }

  const identity: SupabaseUserIdentity = {
    identityData: isObject(value.identity_data) ? value.identity_data : null,
    lastSignInAt: getString(value.last_sign_in_at),
    createdAt: getString(value.created_at),
    updatedAt: getString(value.updated_at)
  };
  const id = getString(value.id);
  const identityId = getString(value.identity_id) ?? getString(value.identityId);
  const provider = getString(value.provider);

  if (id) {
    identity.id = id;
  }

  if (identityId) {
    identity.identityId = identityId;
  }

  if (provider) {
    identity.provider = provider;
  }

  return identity;
}

function normalizeUser(value: unknown): SupabaseUser | null {
  if (!isObject(value)) {
    return null;
  }

  const id = getString(value.id);
  if (!id) {
    return null;
  }

  const identities = Array.isArray(value.identities)
    ? value.identities.map(normalizeIdentity).filter((item): item is SupabaseUserIdentity => Boolean(item))
    : [];

  const user: SupabaseUser = {
    id,
    email: getString(value.email),
    phone: getString(value.phone),
    appMetadata: getOptionalRecord(value.app_metadata),
    userMetadata: getOptionalRecord(value.user_metadata),
    identities,
    createdAt: getString(value.created_at),
    lastSignInAt: getString(value.last_sign_in_at),
    emailConfirmedAt: getString(value.email_confirmed_at),
    phoneConfirmedAt: getString(value.phone_confirmed_at)
  };

  const aud = getString(value.aud);
  const role = getString(value.role);

  if (aud) {
    user.aud = aud;
  }

  if (role) {
    user.role = role;
  }

  return user;
}

function normalizeSession(value: unknown): SupabaseSession | null {
  if (!isObject(value)) {
    return null;
  }

  const accessToken = getString(value.access_token) ?? getString(value.accessToken);
  const refreshToken = getString(value.refresh_token) ?? getString(value.refreshToken);
  const tokenType = getString(value.token_type) ?? getString(value.tokenType) ?? "bearer";
  const user = normalizeUser(value.user);

  if (!accessToken || !refreshToken || !user) {
    return null;
  }

  const expiresInValue = value.expires_in ?? value.expiresIn;
  const expiresAtValue = value.expires_at ?? value.expiresAt;
  const expiresIn =
    typeof expiresInValue === "number" && Number.isFinite(expiresInValue) ? Math.round(expiresInValue) : null;
  const expiresAt =
    typeof expiresAtValue === "number" && Number.isFinite(expiresAtValue) ? Math.round(expiresAtValue) : null;

  return {
    accessToken,
    refreshToken,
    expiresIn,
    expiresAt,
    tokenType,
    user
  };
}

function upsertAppState(key: string, value: unknown): void {
  const db = getDatabase();
  if (!db) {
    return;
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now);
}

function deleteAppState(key: string): void {
  const db = getDatabase();
  db?.prepare("DELETE FROM app_state WHERE key = ?").run(key);
}

function readPersistedSession(): SupabaseSession | null {
  const db = getDatabase();
  if (!db) {
    return null;
  }

  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(SESSION_STATE_KEY) as
    | {
        value: string;
      }
    | undefined;

  if (!row?.value) {
    return null;
  }

  return safeJsonParse<SupabaseSession | null>(row.value, null);
}

function persistSession(session: SupabaseSession | null): SupabaseSession | null {
  memorySession = session;

  if (session) {
    upsertAppState(SESSION_STATE_KEY, session);
  } else {
    deleteAppState(SESSION_STATE_KEY);
  }

  return session;
}

function getStoredSession(): SupabaseSession | null {
  if (memorySession) {
    return memorySession;
  }

  const persisted = readPersistedSession();
  if (persisted) {
    memorySession = persisted;
  }

  return persisted;
}

function buildHeaders(config: SupabaseAuthConfig, accessToken?: string): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${accessToken ?? config.anonKey}`,
    "Content-Type": "application/json"
  };
}

async function parseResponseBody<T>(response: Response): Promise<T | SupabaseErrorBody | null> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T | SupabaseErrorBody;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return {
    message: text
  };
}

export class SupabaseAuthError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SupabaseAuthError";
    this.status = status;
    this.code = code;
  }
}

async function supabaseRequest<T>(
  path: string,
  init: SupabaseRequestInit = {}
): Promise<T | null> {
  const config = getSupabaseAuthConfig(init.config);
  const requestInit: RequestInit = {
    method: init.method ?? "GET",
    headers: buildHeaders(config, init.accessToken)
  };

  if (init.body) {
    requestInit.body = JSON.stringify(init.body);
  }

  const response = await fetch(`${config.url}${path}`, requestInit);
  const body = await parseResponseBody<T>(response);

  if (!response.ok) {
    const errorBody = isObject(body) ? body : {};
    const message =
      getString(errorBody.message) ??
      getString(errorBody.msg) ??
      getString(errorBody.error_description) ??
      getString(errorBody.error) ??
      `Supabase auth request failed with HTTP ${response.status}.`;
    throw new SupabaseAuthError(message, response.status, getString(errorBody.error_code));
  }

  return body as T | null;
}

function buildOtpResult(value: unknown, usedType: SupabaseEmailOtpType | null): EmailOtpResult {
  const body = isObject(value) ? value : {};
  const session = normalizeSession(body);
  const user = normalizeUser(body.user) ?? session?.user ?? null;
  if (session) {
    persistSession(session);
  }

  return {
    messageId: getString(body.message_id) ?? null,
    session,
    user,
    usedType
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getVerifyTypes(type?: SupabaseEmailOtpType): SupabaseEmailOtpType[] {
  if (type) {
    return [type];
  }

  return [...new Set(EMAIL_VERIFY_FALLBACK_ORDER)];
}

function isSessionExpired(session: SupabaseSession, leewaySeconds = 30): boolean {
  if (!session.expiresAt) {
    return false;
  }

  return Date.now() >= session.expiresAt * 1000 - leewaySeconds * 1000;
}

export async function sendEmailOtp(
  input: EmailOtpRequest,
  config?: Partial<SupabaseAuthConfig>
): Promise<EmailOtpResult> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error("Email is required to request an OTP.");
  }

  const body: Record<string, unknown> = {
    email,
    create_user: input.shouldCreateUser ?? true
  };

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.data = input.metadata;
  }

  if (input.captchaToken) {
    body.gotrue_meta_security = {
      captcha_token: input.captchaToken
    };
  }

  const response = await supabaseRequest<Record<string, unknown>>("/auth/v1/otp", {
    method: "POST",
    body,
    config
  });

  return buildOtpResult(response, null);
}

export async function verifyEmailOtp(
  input: VerifyEmailOtpRequest,
  config?: Partial<SupabaseAuthConfig>
): Promise<EmailOtpResult> {
  const email = normalizeEmail(input.email);
  const token = input.token.trim();
  if (!email) {
    throw new Error("Email is required to verify an OTP.");
  }

  if (!token) {
    throw new Error("OTP token is required.");
  }

  let lastError: unknown;

  for (const type of getVerifyTypes(input.type)) {
    try {
      const response = await supabaseRequest<Record<string, unknown>>("/auth/v1/verify", {
        method: "POST",
        body: {
          email,
          token,
          type
        },
        config
      });

      return buildOtpResult(response, type);
    } catch (error) {
      lastError = error;
      if (!(error instanceof SupabaseAuthError) || input.type) {
        throw error;
      }

      if (error.status < 400 || error.status >= 500) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to verify Supabase OTP.");
}

export function getAuthSession(): SupabaseSession | null {
  return getStoredSession();
}

export function clearAuthSession(): void {
  persistSession(null);
}

export async function refreshAuthSession(
  refreshToken?: string,
  config?: Partial<SupabaseAuthConfig>
): Promise<SupabaseSession> {
  const stored = getStoredSession();
  const token = refreshToken?.trim() || stored?.refreshToken;

  if (!token) {
    throw new Error("No refresh token is available.");
  }

  const response = await supabaseRequest<Record<string, unknown>>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: {
      refresh_token: token
    },
    config
  });
  const session = normalizeSession(response);

  if (!session) {
    throw new Error("Supabase did not return a valid refreshed session.");
  }

  persistSession(session);
  return session;
}

export async function getAuthenticatedSession(
  options: {
    refreshIfExpired?: boolean;
    config?: Partial<SupabaseAuthConfig> | undefined;
  } = {}
): Promise<SupabaseSession | null> {
  const session = getStoredSession();
  if (!session) {
    return null;
  }

  if (!options.refreshIfExpired || !isSessionExpired(session)) {
    return session;
  }

  try {
    return await refreshAuthSession(session.refreshToken, options.config);
  } catch {
    clearAuthSession();
    return null;
  }
}

export async function getAuthenticatedUser(config?: Partial<SupabaseAuthConfig>): Promise<SupabaseUser | null> {
  const session = await getAuthenticatedSession({
    refreshIfExpired: true,
    config
  });
  if (!session) {
    return null;
  }

  const response = await supabaseRequest<Record<string, unknown>>("/auth/v1/user", {
    method: "GET",
    accessToken: session.accessToken,
    config
  });
  const user = normalizeUser(response);

  if (!user) {
    return null;
  }

  persistSession({
    ...session,
    user
  });

  return user;
}

export async function signOutAuth(config?: Partial<SupabaseAuthConfig>): Promise<void> {
  const session = getStoredSession();

  try {
    if (session?.accessToken) {
      await supabaseRequest("/auth/v1/logout", {
        method: "POST",
        accessToken: session.accessToken,
        config
      });
    }
  } finally {
    clearAuthSession();
  }
}

export function isAuthenticated(): boolean {
  const session = getStoredSession();
  return Boolean(session && !isSessionExpired(session));
}

export const auth = {
  sendEmailOtp,
  verifyEmailOtp,
  getAuthSession,
  getAuthenticatedSession,
  refreshAuthSession,
  getAuthenticatedUser,
  clearAuthSession,
  signOutAuth,
  isAuthenticated
};

export * from "./config";
export * from "./types";
