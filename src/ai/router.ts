import { AI_SETTINGS } from "./config";
import { getAiProvider } from "./providers";
import { hasAiQuota, isAiHealthy } from "./quota";
import type { AiGenerationRequest, AiProviderName, AiRoutingDecision } from "./types";

// AI router.
// This file decides which providers should be attempted, in which order,
// before the wrapper starts executing the fallback chain.

// Removes duplicates while preserving the first appearance order.
function uniqueProviders(providers: AiProviderName[]): AiProviderName[] {
  return Array.from(new Set(providers));
}

// Builds the requested chain for one generation call.
// Priority rules:
// 1. explicit provider wins
// 2. explicit fallback chain wins if no provider was forced
// 3. otherwise use the global configured default chain
function buildRequestedChain(request: AiGenerationRequest): AiProviderName[] {
  if (request.provider) {
    const fallback = request.fallbackChain?.filter((provider) => provider !== request.provider) ?? AI_SETTINGS.fallbackChain;
    return uniqueProviders([request.provider, ...fallback]);
  }

  if (request.fallbackChain && request.fallbackChain.length > 0) {
    return uniqueProviders(request.fallbackChain);
  }

  return [...AI_SETTINGS.fallbackChain];
}

// Computes the executable AI plan after filtering out unconfigured, unhealthy, or quota-exhausted providers.
export function getAiProviderPlan(request: AiGenerationRequest): AiRoutingDecision {
  const requestedChain = buildRequestedChain(request);
  const chain: AiProviderName[] = [];
  const skipped: AiRoutingDecision["skipped"] = [];

  for (const provider of requestedChain) {
    const adapter = getAiProvider(provider);

    if (!adapter.isConfigured()) {
      skipped.push({
        provider,
        reason: "provider is not configured"
      });
      continue;
    }

    if (!isAiHealthy(provider)) {
      skipped.push({
        provider,
        reason: "provider is unhealthy"
      });
      continue;
    }

    if (!hasAiQuota(provider)) {
      skipped.push({
        provider,
        reason: "provider quota is exhausted"
      });
      continue;
    }

    chain.push(provider);
  }

  const primary = chain[0] ?? null;
  const reason = primary
    ? `Deterministic AI fallback chain selected ${primary} first.`
    : "No configured healthy AI providers with quota were available.";

  return {
    primary,
    chain,
    requestedProvider: request.provider ?? null,
    attempted: [],
    skipped,
    reason
  };
}

// Appends one attempted provider to the routing decision.
// The wrapper uses this so the final response can explain exactly which fallbacks were tried.
export function markAiAttempt(
  decision: AiRoutingDecision,
  provider: AiProviderName
): AiRoutingDecision {
  return {
    ...decision,
    attempted: decision.attempted.includes(provider) ? decision.attempted : [...decision.attempted, provider]
  };
}




