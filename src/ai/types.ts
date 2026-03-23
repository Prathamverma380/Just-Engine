import type { ImageIntent } from "../types/wallpaper";

// Shared AI vocabulary.
// This file is the contract layer for the whole AI subsystem:
// providers, routing, quota tracking, persistence, and normalized responses.
export const AI_PROVIDER_NAMES = ["openai", "nano_banana", "eleven_labs"] as const;

export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];
// Different providers return hosted URLs, base64 payloads, or both.
export type AiProviderOutputMode = "url" | "base64" | "mixed";
// These error codes are intentionally normalized so the wrapper and engine do not
// need provider-specific error parsing rules everywhere.
export type AiProviderErrorCode =
  | "disabled"
  | "missing_credentials"
  | "missing_endpoint"
  | "invalid_request"
  | "rate_limited"
  | "quota_exhausted"
  | "authentication_failed"
  | "upstream_failure"
  | "empty_response"
  | "storage_failed";

// Public generation options exposed to callers such as the engine or future API routes.
// These are the user-facing knobs for "how should the image be made?"
export interface AiGenerationOptions {
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  negativePrompt?: string;
  count?: number;
  provider?: AiProviderName;
  fallbackChain?: AiProviderName[];
  persist?: boolean;
  userId?: string;
}

// This is the normalized input that enters the AI orchestration layer.
// By the time we reach provider adapters, every call should already look like this.
export interface AiGenerationRequest extends AiGenerationOptions {
  prompt: string;
  category: string;
}

// This is the one image shape the rest of the app consumes.
// Provider-specific payloads get converted into this before they leave `src/ai`.
export interface AiGeneratedImage {
  url: string;
  width: number;
  height: number;
  mimeType?: string;
  revisedPrompt?: string;
}

// Capabilities tell the router and wrapper what a provider can realistically do.
// This is where we record whether style, negative prompts, or batch counts are supported.
export interface AiProviderCapabilities {
  supportsStyle: boolean;
  supportsNegativePrompt: boolean;
  maxImagesPerRequest: number;
  outputMode: AiProviderOutputMode;
  supportsSupabasePersistence: boolean;
}

// Static quota envelopes configured per provider.
// Some hosts use minute/hour/day/month budgets, others leave some windows unlimited.
export interface AiQuotaLimits {
  minute?: number;
  hourly?: number;
  daily?: number;
  monthly?: number;
  reserveRatio: number;
  requiresKey: boolean;
}

// Runtime rate-limit information observed from upstream response headers.
// This is more precise than static config when the provider actually reports live remaining quota.
export interface AiRateLimitSnapshot {
  limit: number | "infinite" | null;
  remaining: number | "infinite" | null;
  resetAt: number | null;
}

// Operator-facing quota snapshot for one AI provider.
// This is what dashboards, health checks, or debugging tools can render directly.
export interface AiProviderQuotaSnapshot {
  provider: AiProviderName;
  healthy: boolean;
  configured: boolean;
  remaining: number | "infinite";
  minuteRemaining?: number | "infinite";
  hourlyRemaining?: number | "infinite";
  dailyRemaining?: number | "infinite";
  monthlyRemaining?: number | "infinite";
  observedLimit?: number | "infinite" | null;
  observedRemaining?: number | "infinite" | null;
  rateLimitResetAt?: number | null;
  totalRequests: number;
  failures: number;
  latency: number | null;
}

// Routing decision for a generation request.
// The wrapper computes this before execution and updates `attempted` as fallback proceeds.
export interface AiRoutingDecision {
  primary: AiProviderName | null;
  chain: AiProviderName[];
  requestedProvider: AiProviderName | null;
  attempted: AiProviderName[];
  skipped: Array<{
    provider: AiProviderName;
    reason: string;
  }>;
  reason: string;
}

// Normalized provider error shape.
// Adapters can throw raw errors internally, but the shared layer converts them into this.
export interface AiProviderErrorShape {
  provider: AiProviderName;
  code: AiProviderErrorCode;
  message: string;
  status: number | null;
  retryable: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

// Final AI response returned to the engine.
// This includes both the generated images and the operational metadata explaining how we got them.
export interface AiGenerationResponse {
  provider: AiProviderName;
  model: string;
  prompt: string;
  latencyMs: number;
  images: AiGeneratedImage[];
  route: AiRoutingDecision;
  quota: AiProviderQuotaSnapshot | null;
  persisted: boolean;
  persistedId?: string;
}

// Result of prompt-intent detection.
// This is used only when the engine is deciding whether to search or generate.
export interface ImageIntentDetection {
  requestedIntent: ImageIntent;
  resolvedIntent: "search" | "generate";
  score: number;
  signals: string[];
}

// Fully resolved execution context passed into one provider adapter.
// The wrapper creates this so each provider gets concrete values instead of fallback logic.
export interface AiProviderRequestContext {
  provider: AiProviderName;
  request: AiGenerationRequest;
  resolvedModel: string;
  resolvedSize: string;
  resolvedQuality: string;
  resolvedStyle: string;
  resolvedCount: number;
  timeoutMs: number;
}

// Provider adapters return this internal result shape back to the wrapper.
// The wrapper then adds routing, persistence, and quota metadata around it.
export interface AiProviderGenerationResult {
  provider: AiProviderName;
  model: string;
  prompt: string;
  latencyMs: number;
  images: AiGeneratedImage[];
  rateLimit: AiRateLimitSnapshot | null;
}

// Static config shape for one provider entry in `src/ai/config.ts`.
export interface AiProviderSettings {
  enabled: boolean;
  apiKey: string;
  apiUrl: string;
  defaultModel: string;
  defaultSize: string;
  defaultQuality: string;
  defaultStyle: string;
  timeoutMs: number;
} 

// Payload written to Supabase when generation persistence is enabled.
export interface AiGeneratedContentRecord {
  provider: AiProviderName;
  model: string;
  prompt: string;
  category: string;
  userId?: string;
  request: AiGenerationRequest;
  response: AiGenerationResponse;
}

// Small result returned by the persistence layer so callers know whether storage succeeded.
export interface PersistedAiGeneration {
  id: string | null;
  persisted: boolean;
}

// Test-only hook for swapping a live provider call with a fake deterministic response.
export type AiProviderOverride = (
  context: AiProviderRequestContext
) => Promise<AiProviderGenerationResult>;

// Every concrete provider adapter must implement this shape.
// The wrapper depends on this contract, not on provider-specific modules directly.
export interface AiProviderAdapter {
  readonly name: AiProviderName;
  readonly capabilities: AiProviderCapabilities;
  isConfigured(): boolean;
  generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult>;
}
