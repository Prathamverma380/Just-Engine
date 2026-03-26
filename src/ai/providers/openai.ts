import { AI_PROVIDER_SETTINGS } from "../config";
import { fetchJsonDetailed, retry } from "../../utils";
import type {
  AiProviderAdapter,
  AiProviderCapabilities,
  AiProviderGenerationResult,
  AiProviderRequestContext
} from "../types";
import {
  clampImageCount,
  composePrompt,
  createAiProviderError,
  normalizeCompatibleImages,
  normalizeProviderFailure
} from "./shared";

// OpenAI adapter.
// This provider uses the OpenAI Images API shape and returns normalized images to the wrapper.

type OpenAiGenerationResponse = {
  data?: Array<{
    url?: string;
    b64_json?: string;
    mime_type?: string;
    revised_prompt?: string;
  }>;
};

// Capability declaration for the router/wrapper.
const capabilities: AiProviderCapabilities = {
  supportsStyle: true,
  supportsNegativePrompt: true,
  maxImagesPerRequest: 10,
  outputMode: "mixed",
  supportsSupabasePersistence: true
};

function isDallE3Model(model: string): boolean {
  return model.trim().toLowerCase() === "dall-e-3";
}

function resolveOpenAiImageCount(model: string, count: number | undefined): number {
  const clamped = clampImageCount(count, capabilities.maxImagesPerRequest);
  return isDallE3Model(model) ? 1 : clamped;
}

function resolveOpenAiQuality(model: string, quality: string): string {
  if (!isDallE3Model(model)) {
    return quality;
  }

  const normalized = quality.trim().toLowerCase();
  return normalized === "hd" || normalized === "high" ? "hd" : "standard";
}

export const openAiProvider: AiProviderAdapter = {
  name: "openai",
  capabilities,
  // A provider is considered configured only when it is enabled and has the minimum credentials it needs.
  isConfigured(): boolean {
    const settings = AI_PROVIDER_SETTINGS.openai;
    return settings.enabled && settings.apiKey.trim().length > 0 && settings.apiUrl.trim().length > 0;
  },
  // Executes one real OpenAI image-generation request.
  // All provider-specific request/response handling stays inside this adapter.
  async generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult> {
    const settings = AI_PROVIDER_SETTINGS.openai;

    if (!settings.enabled) {
      throw createAiProviderError({
        provider: "openai",
        code: "disabled",
        message: "OpenAI image generation is disabled.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiKey.trim()) {
      throw createAiProviderError({
        provider: "openai",
        code: "missing_credentials",
        message: "OpenAI image generation is not configured: missing API key.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiUrl.trim()) {
      throw createAiProviderError({
        provider: "openai",
        code: "missing_endpoint",
        message: "OpenAI image generation is not configured: missing endpoint.",
        status: null,
        retryable: false
      });
    }

    const startedAt = Date.now();

    try {
      // Retry once for transient failures such as short-lived upstream issues.
      const result = await retry(
        () =>
          fetchJsonDetailed<OpenAiGenerationResponse>(
            settings.apiUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.apiKey}`
              },
              body: JSON.stringify({
                model: context.resolvedModel,
                prompt: composePrompt(
                  context.request.prompt,
                  context.request.negativePrompt,
                  context.resolvedStyle
                ),
                size: context.resolvedSize,
                // DALL-E 3 still uses the Images API, but it accepts `standard/hd`
                // quality and supports only a single image per request.
                quality: resolveOpenAiQuality(context.resolvedModel, context.resolvedQuality),
                n: resolveOpenAiImageCount(context.resolvedModel, context.request.count)
              })
            },
            context.timeoutMs
          ),
        2
      );

      // Convert the raw upstream payload into the shared engine-facing image shape.
      const images = normalizeCompatibleImages("openai", result.data.data, context.resolvedSize);
      if (images.length === 0) {
        throw createAiProviderError({
          provider: "openai",
          code: "empty_response",
          message: "OpenAI returned no images.",
          status: null,
          retryable: true
        });
      }

      return {
        provider: "openai",
        model: context.resolvedModel,
        prompt: context.request.prompt,
        latencyMs: Date.now() - startedAt,
        images,
        rateLimit: result.rateLimit
      };
    } catch (error) {
      // The wrapper only wants normalized provider failures, not raw HTTP/JSON parsing errors.
      throw normalizeProviderFailure("openai", error, "OpenAI image generation failed.");
    }
  }
};
