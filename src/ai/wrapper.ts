import { requirePremiumViewer } from "../access";
import { FEATURE_FLAGS } from "../config";
import { AI_PROVIDER_SETTINGS, AI_SETTINGS, AI_STORAGE_SETTINGS } from "./config";
import { getAiProvider, setAiProviderOverrideForTests } from "./providers";
import { clampImageCount, normalizeProviderFailure } from "./providers/shared";
import { getAiQuotaReport, recordAiUsage } from "./quota";
import { getAiProviderPlan, markAiAttempt } from "./router";
import { persistAiGeneration } from "./storage";
import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiProviderName,
  AiProviderQuotaSnapshot,
  AiProviderRequestContext
} from "./types";

// AI wrapper / orchestrator.
// This is the public entry point for image generation. It does not talk to a single provider directly;
// instead it resolves a provider plan, executes the fallback chain, records quota/health, and optionally persists results.

// Whole-wrapper test hook used by integration tests that want to bypass routing entirely.
type GenerationOverride = (request: AiGenerationRequest) => Promise<AiGenerationResponse>;

let generationOverrideForTests: GenerationOverride | null = null;

// Resolves the final concrete context that one provider adapter should execute with.
// This is where provider defaults and request overrides are merged together.
function resolveProviderContext(
  provider: AiProviderName,
  request: AiGenerationRequest,
  primaryProvider: AiProviderName | null
): AiProviderRequestContext {
  const settings = AI_PROVIDER_SETTINGS[provider];
  const shouldUseRequestedModel = request.provider === provider || (!request.provider && primaryProvider === provider);

  return {
    provider,
    request,
    resolvedModel: shouldUseRequestedModel ? request.model?.trim() || settings.defaultModel : settings.defaultModel,
    resolvedSize: request.size?.trim() || settings.defaultSize || AI_SETTINGS.defaultSize,
    resolvedQuality: request.quality?.trim() || settings.defaultQuality || AI_SETTINGS.defaultQuality,
    resolvedStyle: request.style?.trim() || settings.defaultStyle || AI_SETTINGS.defaultStyle,
    resolvedCount: clampImageCount(
      request.count ?? AI_SETTINGS.maxImagesPerRequest,
      getAiProvider(provider).capabilities.maxImagesPerRequest
    ),
    timeoutMs: settings.timeoutMs
  };
}

// Convenience lookup for the latest provider quota snapshot after a successful call.
function getProviderQuota(provider: AiProviderName): AiProviderQuotaSnapshot | null {
  return getAiQuotaReport()[provider] ?? null;
}

// Wrapper-level test override. This bypasses provider routing entirely.
export function setGenerateImageOverrideForTests(override: GenerationOverride | null): void {
  generationOverrideForTests = override;
}

export { setAiProviderOverrideForTests };

export async function generateImage(request: AiGenerationRequest): Promise<AiGenerationResponse> {
  const viewer = await requirePremiumViewer();
  const effectiveRequest: AiGenerationRequest = {
    ...request,
    userId: viewer.user.id
  };

  // Hard gate so hosts can disable AI generation globally without changing callers.
  if (!FEATURE_FLAGS.enableAiGeneration) {
    throw new Error("AI image generation is disabled by feature flag.");
  }

  // Tests can replace the whole generation pipeline with a deterministic fake.
  if (generationOverrideForTests) {
    return generationOverrideForTests(effectiveRequest);
  }

  const startedAt = Date.now();
  // Build the deterministic fallback plan before any live provider call is attempted.
  const initialRoute = getAiProviderPlan(effectiveRequest);
  if (initialRoute.chain.length === 0) {
    const skipped = initialRoute.skipped.map((item) => `${item.provider}: ${item.reason}`).join(", ");
    throw new Error(skipped ? `AI generation unavailable. ${skipped}` : "AI generation unavailable.");
  }

  let route = initialRoute;
  let lastError: Error | null = null;

  for (const provider of initialRoute.chain) {
    // As we move through fallbacks, the route is updated so the final response can explain the path taken.
    route = markAiAttempt(route, provider);
    const context = resolveProviderContext(provider, effectiveRequest, initialRoute.primary);

    try {
      // Execute the provider-specific adapter with fully resolved settings.
      const result = await getAiProvider(provider).generate(context);
      recordAiUsage(provider, {
        success: true,
        latencyMs: result.latencyMs,
        rateLimit: result.rateLimit
      });

      const response: AiGenerationResponse = {
        provider: result.provider,
        model: result.model,
        prompt: effectiveRequest.prompt,
        latencyMs: Date.now() - startedAt,
        images: result.images.slice(0, context.resolvedCount),
        route,
        quota: getProviderQuota(provider),
        persisted: false
      };

      // Persistence is optional. Generation should still succeed even if storage is later disabled.
      if ((request.persist ?? AI_STORAGE_SETTINGS.enabled) && response.images.length > 0) {
        try {
          const persisted = await persistAiGeneration({
            provider: response.provider,
            model: response.model,
            prompt: effectiveRequest.prompt,
            category: effectiveRequest.category,
            ...(effectiveRequest.userId ? { userId: effectiveRequest.userId } : {}),
            request: effectiveRequest,
            response
          });
          response.persisted = persisted.persisted;
          if (persisted.id) {
            response.persistedId = persisted.id;
          }
        } catch (error) {
          // Persistence failure is normalized and retained as the most recent error,
          // but we still return the generated images because generation itself succeeded.
          lastError = normalizeProviderFailure(provider, error, "AI generation persistence failed.");
        }
      }

      return response;
    } catch (error) {
      // Any provider failure is normalized, recorded, and then fallback continues to the next provider.
      const normalizedError = normalizeProviderFailure(provider, error, `${provider} image generation failed.`);
      recordAiUsage(provider, {
        success: false
      });
      lastError = normalizedError;
    }
  }

  // If every provider in the chain failed, surface the most useful final error.
  throw lastError ?? new Error("AI generation failed.");
}
