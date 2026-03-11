// This file is the traffic controller for provider budgets.
// It does not call APIs itself; it just remembers how much of each source we have spent.
import { SOURCE_LIMITS, isSourceConfigured } from "../config";
import {
  REMOTE_WALLPAPER_SOURCES,
  type RateLimitSnapshot,
  type RemoteWallpaperSource,
  type SourceQuotaSnapshot
} from "../types/wallpaper";

// This tracks the live runtime counters for each source.
// One source, one rolling set of counters.
interface SourceRuntimeState {
  minuteBucket: string;
  hourlyBucket: string;
  monthlyBucket: string;
  minuteRequests: number;
  hourlyRequests: number;
  monthlyRequests: number;
  totalRequests: number;
  consecutiveFailures: number;
  lastLatency: number | null;
  observedRateLimit: RateLimitSnapshot | null;
}

// Fresh state for a source before any requests have been made.
// New sources start with zero traffic and no failure history.
const initialState = (): SourceRuntimeState => ({
  minuteBucket: currentMinuteBucket(),
  hourlyBucket: currentHourBucket(),
  monthlyBucket: currentMonthBucket(),
  minuteRequests: 0,
  hourlyRequests: 0,
  monthlyRequests: 0,
  totalRequests: 0,
  consecutiveFailures: 0,
  lastLatency: null,
  observedRateLimit: null
});

// All counters live in-memory because this is enough for backend runtime behavior and testing.
// Runtime-only state is enough for now because quota is mainly used for in-process routing decisions.
const runtimeState: Record<RemoteWallpaperSource, SourceRuntimeState> = {
  unsplash: initialState(),
  pexels: initialState(),
  pixabay: initialState(),
  nasa: initialState(),
  picsum: initialState()
};

// Providers reset on different windows, so we keep bucket helpers separate and explicit.
// Each of these helpers answers "which bucket are we in right now?"
function currentMinuteBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}-${date.getUTCMinutes()}`;
}

function currentHourBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${date.getUTCHours()}`;
}

function currentMonthBucket(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

// Before reading or writing counters, make sure the current window is still valid.
// If the clock rolled over into a new minute/hour/month, reset that specific window.
function resetWindowsIfNeeded(source: RemoteWallpaperSource): void {
  const state = runtimeState[source];
  const minuteBucket = currentMinuteBucket();
  const hourlyBucket = currentHourBucket();
  const monthlyBucket = currentMonthBucket();

  if (state.minuteBucket !== minuteBucket) {
    state.minuteBucket = minuteBucket;
    state.minuteRequests = 0;
  }

  if (state.hourlyBucket !== hourlyBucket) {
    state.hourlyBucket = hourlyBucket;
    state.hourlyRequests = 0;
  }

  if (state.monthlyBucket !== monthlyBucket) {
    state.monthlyBucket = monthlyBucket;
    state.monthlyRequests = 0;
  }
}

// Reserves some quota instead of burning a source down to zero.
// Reserve ratios stop the engine from driving a source right to the cliff edge.
function remaining(limit: number | undefined, used: number, reserveRatio: number): number | "infinite" {
  if (limit === undefined || !Number.isFinite(limit)) {
    return "infinite";
  }

  const reserved = Math.ceil(limit * reserveRatio);
  return Math.max(0, limit - used - reserved);
}

// Every client attempt passes through here so health and usage stay in sync.
// Every successful or failed provider attempt should be recorded here.
export function recordUsage(
  source: RemoteWallpaperSource,
  result: { success: boolean; latencyMs?: number | null; rateLimit?: RateLimitSnapshot | null }
): void {
  resetWindowsIfNeeded(source);
  const state = runtimeState[source];
  const limits = SOURCE_LIMITS[source];

  if (limits.minute !== undefined && Number.isFinite(limits.minute)) {
    state.minuteRequests += 1;
  }

  if (limits.hourly !== undefined && Number.isFinite(limits.hourly)) {
    state.hourlyRequests += 1;
  }

  if (limits.monthly !== undefined && Number.isFinite(limits.monthly)) {
    state.monthlyRequests += 1;
  }

  state.totalRequests += 1;
  state.lastLatency = result.latencyMs ?? state.lastLatency;
  state.consecutiveFailures = result.success ? 0 : state.consecutiveFailures + 1;
  state.observedRateLimit = result.rateLimit ?? state.observedRateLimit;
}

// Gives the router a normalized view of what quota is still safe to spend.
// Gives the router a normalized answer to "what is still safe to spend?"
export function getRemaining(source: RemoteWallpaperSource): {
  minute: number | "infinite";
  hourly: number | "infinite";
  monthly: number | "infinite";
} {
  resetWindowsIfNeeded(source);
  const state = runtimeState[source];
  const limits = SOURCE_LIMITS[source];

  return {
    minute: remaining(limits.minute, state.minuteRequests, limits.reserveRatio),
    hourly: remaining(limits.hourly, state.hourlyRequests, limits.reserveRatio),
    monthly: remaining(limits.monthly, state.monthlyRequests, limits.reserveRatio)
  };
}

// The router uses this to skip sources that are technically available but strategically exhausted.
// If any bounded window is exhausted, we stop treating the source as usable.
export function hasQuota(source: RemoteWallpaperSource): boolean {
  const observedRemaining = runtimeState[source].observedRateLimit?.remaining;
  if (observedRemaining !== undefined && observedRemaining !== null && observedRemaining !== "infinite") {
    if (observedRemaining <= 0) {
      return false;
    }
  }

  const values = Object.values(getRemaining(source));
  return values.every((value) => value === "infinite" || value > 0);
}

// A source is considered healthy only if it is configured and has not recently failed too many times.
// Health here means "configured and not repeatedly failing", not "actively pinged right this second".
export function isHealthy(source: RemoteWallpaperSource): boolean {
  return isSourceConfigured(source) && runtimeState[source].consecutiveFailures < 3;
}

// This is mostly for testing and forcing rollover behavior.
// Mostly a testing hook.
export function resetHourly(): void {
  for (const source of REMOTE_WALLPAPER_SOURCES) {
    runtimeState[source].hourlyBucket = currentHourBucket(new Date(Date.now() - 3600000));
  }
}

// Health and stats screens consume this report instead of reaching into tracker internals.
// Converts all runtime counters into one clean report object.
export function getQuotaReport(): Record<RemoteWallpaperSource, SourceQuotaSnapshot> {
  return REMOTE_WALLPAPER_SOURCES.reduce<Record<RemoteWallpaperSource, SourceQuotaSnapshot>>(
    (report, source) => {
      const state = runtimeState[source];
      const remainingQuota = getRemaining(source);
      const primaryRemaining =
        remainingQuota.minute !== "infinite"
          ? remainingQuota.minute
          : remainingQuota.hourly !== "infinite"
            ? remainingQuota.hourly
            : remainingQuota.monthly;

      report[source] = {
        source,
        healthy: isHealthy(source),
        configured: isSourceConfigured(source),
        remaining: primaryRemaining,
        latency: state.lastLatency,
        minuteRemaining: remainingQuota.minute,
        hourlyRemaining: remainingQuota.hourly,
        monthlyRemaining: remainingQuota.monthly,
        observedLimit: state.observedRateLimit?.limit ?? null,
        observedRemaining: state.observedRateLimit?.remaining ?? null,
        rateLimitResetAt: state.observedRateLimit?.resetAt ?? null,
        totalRequests: state.totalRequests,
        failures: state.consecutiveFailures
      };
      return report;
    },
    {} as Record<RemoteWallpaperSource, SourceQuotaSnapshot>
  );
}
