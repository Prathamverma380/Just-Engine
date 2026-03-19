export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

export type SupabaseEmailOtpType =
  | "email"
  | "magiclink"
  | "signup"
  | "invite"
  | "recovery"
  | "email_change";

export interface EmailOtpRequest {
  email: string;
  shouldCreateUser?: boolean;
  metadata?: Record<string, unknown>;
  captchaToken?: string;
}

export interface VerifyEmailOtpRequest {
  email: string;
  token: string;
  type?: SupabaseEmailOtpType;
}

export interface SupabaseUserIdentity {
  id?: string;
  identityId?: string;
  provider?: string;
  identityData?: Record<string, unknown> | null;
  lastSignInAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SupabaseUser {
  id: string;
  aud?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
  identities: SupabaseUserIdentity[];
  createdAt?: string | null;
  lastSignInAt?: string | null;
  emailConfirmedAt?: string | null;
  phoneConfirmedAt?: string | null;
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number | null;
  expiresAt: number | null;
  tokenType: string;
  user: SupabaseUser;
}

export interface EmailOtpResult {
  messageId: string | null;
  session: SupabaseSession | null;
  user: SupabaseUser | null;
  usedType: SupabaseEmailOtpType | null;
}
