import { AI_PROVIDER_LIMITS } from "./config";
import { getAiProvider } from "./providers";
import { AI_PROVIDER_NAMES, type AiProviderName, type AiProviderQuotaSnapshot, type AiRateLimitSnapshot } from "./types";

// AI quota tracker.
// This mirrors the wallpaper-source quota tracker, but it is scoped to image-generation providers.
interface AiProviderRuntimeState {
  minuteBucket: string;
  hourlyBucket: string;
  dailyBucket: string;
  monthlyBucket: string;
  minuteRequests: number;
  hourlyRequests: number;
  dailyRequests: number;
  monthlyRequests: number;
  totalRequests: number;
  consecutiveFailures: number;
  lastLatency: number | null;
  observedRateLimit: AiRateLimitSnapshot | null;
}

// Bucket helpers define when a rolling quota window resets.
function currentMinuteBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}`;
}

function currentHourBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;
}

function currentDayBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function currentMonthBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

// Fresh runtime state for one provider before any generation requests have been made.
function initialState(): AiProviderRuntimeState {
  return {
    minuteBucket: currentMinuteBucket(),
    hourlyBucket: currentHourBucket(),
    dailyBucket: currentDayBucket(),
    monthlyBucket: currentMonthBucket(),
    minuteRequests: 0,
    hourlyRequests: 0,
    dailyRequests: 0,
    monthlyRequests: 0,
    totalRequests: 0,
    consecutiveFailures: 0,
    lastLatency: null,
    observedRateLimit: null
  };
}

// In-memory runtime state for all AI providers.
// This powers health/routing decisions during the current process lifetime.
const runtimeState: Record<AiProviderName, AiProviderRuntimeState> = {
  openai: initialState(),
  nano_banana: initialState(),
  silicon_flow: initialState()
};

// Rolls counters forward when the current minute/hour/day/month changes.
function resetWindowsIfNeeded(provider: AiProviderName): void {
  const state = runtimeState[provider];
  const minuteBucket = currentMinuteBucket();
  const hourlyBucket = currentHourBucket();
  const dailyBucket = currentDayBucket();
  const monthlyBucket = currentMonthBucket();

  if (state.minuteBucket !== minuteBucket) {
    state.minuteBucket = minuteBucket;
    state.minuteRequests = 0;
  }

  if (state.hourlyBucket !== hourlyBucket) {
    state.hourlyBucket = hourlyBucket;
    state.hourlyRequests = 0;
  }

  if (state.dailyBucket !== dailyBucket) {
    state.dailyBucket = dailyBucket;
    state.dailyRequests = 0;
  }

  if (state.monthlyBucket !== monthlyBucket) {
    state.monthlyBucket = monthlyBucket;
    state.monthlyRequests = 0;
  }
}

// Applies a reserve ratio so the router stops spending quota before a provider hits hard zero.
function remaining(limit: number | undefined, used: number, reserveRatio: number): number | "infinite" {
  if (limit === undefined || !Number.isFinite(limit)) {
    return "infinite";
  }

  const reserved = Math.ceil(limit * reserveRatio);
  return Math.max(0, limit - used - reserved);
}

// Records a successful or failed provider attempt.
// The wrapper calls this after each real provider execution.
export function recordAiUsage(
  provider: AiProviderName,
  result: { success: boolean; latencyMs?: number | null; rateLimit?: AiRateLimitSnapshot | null }
): void {
  resetWindowsIfNeeded(provider);
  const state = runtimeState[provider];
  const limits = AI_PROVIDER_LIMITS[provider];

  if (limits.minute !== undefined && Number.isFinite(limits.minute)) {
    state.minuteRequests += 1;
  }

  if (limits.hourly !== undefined && Number.isFinite(limits.hourly)) {
    state.hourlyRequests += 1;
  }

  if (limits.daily !== undefined && Number.isFinite(limits.daily)) {
    state.dailyRequests += 1;
  }

  if (limits.monthly !== undefined && Number.isFinite(limits.monthly)) {
    state.monthlyRequests += 1;
  }

  state.totalRequests += 1;
  state.lastLatency = result.latencyMs ?? state.lastLatency;
  state.consecutiveFailures = result.success ? 0 : state.consecutiveFailures + 1;
  state.observedRateLimit = result.rateLimit ?? state.observedRateLimit;
}

// Returns the currently safe-to-spend quota for one provider across all tracked windows.
export function getAiRemaining(provider: AiProviderName): {
  minute: number | "infinite";
  hourly: number | "infinite";
  daily: number | "infinite";
  monthly: number | "infinite";
} {
  resetWindowsIfNeeded(provider);
  const state = runtimeState[provider];
  const limits = AI_PROVIDER_LIMITS[provider];

  return {
    minute: remaining(limits.minute, state.minuteRequests, limits.reserveRatio),
    hourly: remaining(limits.hourly, state.hourlyRequests, limits.reserveRatio),
    daily: remaining(limits.daily, state.dailyRequests, limits.reserveRatio),
    monthly: remaining(limits.monthly, state.monthlyRequests, limits.reserveRatio)
  };
}

// Fast yes/no answer for the router.
// If any bounded quota window is exhausted, the provider should be skipped.
export function hasAiQuota(provider: AiProviderName): boolean {
  const observedRemaining = runtimeState[provider].observedRateLimit?.remaining;
  if (observedRemaining !== undefined && observedRemaining !== null && observedRemaining !== "infinite") {
    if (observedRemaining <= 0) {
      return false;
    }
  }

  const values = Object.values(getAiRemaining(provider));
  return values.every((value) => value === "infinite" || value > 0);
}

// Health means "configured and not repeatedly failing", not "guaranteed up right now".
export function isAiHealthy(provider: AiProviderName): boolean {
  return getAiProvider(provider).isConfigured() && runtimeState[provider].consecutiveFailures < 3;
}

// Latency is tracked mainly for diagnostics and possible future ranking strategies.
export function getAiLastLatency(provider: AiProviderName): number | null {
  return runtimeState[provider].lastLatency;
}

// Test helper for clearing runtime AI quota state.
export function resetAiQuotaState(): void {
  for (const provider of AI_PROVIDER_NAMES) {
    runtimeState[provider] = initialState();
  }
}

// Builds an operator-friendly snapshot of AI provider health, quota, and failure counts.
export function getAiQuotaReport(): Record<AiProviderName, AiProviderQuotaSnapshot> {
  return AI_PROVIDER_NAMES.reduce<Record<AiProviderName, AiProviderQuotaSnapshot>>((report, provider) => {
    const state = runtimeState[provider];
    const remainingQuota = getAiRemaining(provider);
    const primaryRemaining =
      remainingQuota.minute !== "infinite"
        ? remainingQuota.minute
        : remainingQuota.hourly !== "infinite"
          ? remainingQuota.hourly
          : remainingQuota.daily !== "infinite"
            ? remainingQuota.daily
            : remainingQuota.monthly;

    report[provider] = {
      provider,
      healthy: isAiHealthy(provider),
      configured: getAiProvider(provider).isConfigured(),
      remaining: primaryRemaining,
      minuteRemaining: remainingQuota.minute,
      hourlyRemaining: remainingQuota.hourly,
      dailyRemaining: remainingQuota.daily,
      monthlyRemaining: remainingQuota.monthly,
      observedLimit: state.observedRateLimit?.limit ?? null,
      observedRemaining: state.observedRateLimit?.remaining ?? null,
      rateLimitResetAt: state.observedRateLimit?.resetAt ?? null,
      totalRequests: state.totalRequests,
      failures: state.consecutiveFailures,
      latency: state.lastLatency
    };

    return report;
  }, {} as Record<AiProviderName, AiProviderQuotaSnapshot>);
}
