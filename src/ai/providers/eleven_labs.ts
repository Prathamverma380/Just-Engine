import { AI_PROVIDER_SETTINGS } from "../config";
import { fetchJsonDetailed, retry } from "../../utils";
import type {
  AiGeneratedImage,
  AiProviderAdapter,
  AiProviderCapabilities,
  AiProviderGenerationResult,
  AiProviderRequestContext
} from "../types";
import {
  buildImageDataUrl,
  clampImageCount,
  composePrompt,
  createAiProviderError,
  normalizeProviderFailure,
  parseDimensions
} from "./shared";

// ElevenLabs adapter.
// This adapter is intentionally tolerant because the final live endpoint contract is still configurable.

type GenericImageValue = {
  url?: string;
  image_url?: string;
  b64_json?: string;
  base64?: string;
  image_base64?: string;
  mime_type?: string;
  mimeType?: string;
  revised_prompt?: string;
};

type ElevenLabsGenerationResponse = Record<string, unknown>;

// Declares the current assumptions about ElevenLabs image generation behavior.
const capabilities: AiProviderCapabilities = {
  supportsStyle: true,
  supportsNegativePrompt: true,
  maxImagesPerRequest: 4,
  outputMode: "mixed",
  supportsSupabasePersistence: true
};

// Defensive helper for unpacking untyped JSON response objects.
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// Attempts to normalize a few plausible image-response shapes into the shared image array.
// This keeps the adapter useful while the final endpoint shape remains configurable.
function normalizeGenericImages(payload: ElevenLabsGenerationResponse, size: string): AiGeneratedImage[] {
  const dimensions = parseDimensions(size);
  const candidates = [
    ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray(payload.images) ? payload.images : [])
  ];

  if (candidates.length === 0) {
    const singleImage = typeof payload.image === "string" ? payload.image : typeof payload.url === "string" ? payload.url : null;
    if (!singleImage) {
      return [];
    }

    return [
      {
        url: singleImage,
        width: dimensions.width,
        height: dimensions.height
      }
    ];
  }

  return candidates.flatMap((candidate) => {
    const item = asRecord(candidate) as GenericImageValue;
    const base64 = item.b64_json?.trim() || item.base64?.trim() || item.image_base64?.trim() || "";
    const url = item.url?.trim() || item.image_url?.trim() || "";

    if (!url && !base64) {
      return [];
    }

    const image: AiGeneratedImage = {
      url: url || buildImageDataUrl(base64, item.mime_type?.trim() || item.mimeType?.trim() || "image/png"),
      width: dimensions.width,
      height: dimensions.height
    };

    const mimeType = item.mime_type?.trim() || item.mimeType?.trim();
    if (mimeType) {
      image.mimeType = mimeType;
    }

    if (item.revised_prompt?.trim()) {
      image.revisedPrompt = item.revised_prompt.trim();
    }

    return [image];
  });
}

export const elevenLabsProvider: AiProviderAdapter = {
  name: "eleven_labs",
  capabilities,
  // The adapter remains disabled for routing until both key and endpoint are supplied.
  isConfigured(): boolean {
    const settings = AI_PROVIDER_SETTINGS.eleven_labs;
    return settings.enabled && settings.apiKey.trim().length > 0 && settings.apiUrl.trim().length > 0;
  },
  // Executes one configurable ElevenLabs request and tries to normalize the response shape.
  async generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult> {
    const settings = AI_PROVIDER_SETTINGS.eleven_labs;

    if (!settings.enabled) {
      throw createAiProviderError({
        provider: "eleven_labs",
        code: "disabled",
        message: "ElevenLabs image generation is disabled.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiKey.trim()) {
      throw createAiProviderError({
        provider: "eleven_labs",
        code: "missing_credentials",
        message: "ElevenLabs image generation is not configured: missing API key.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiUrl.trim()) {
      throw createAiProviderError({
        provider: "eleven_labs",
        code: "missing_endpoint",
        message: "ElevenLabs image generation is not configured: missing ELEVENLABS_IMAGE_API_URL.",
        status: null,
        retryable: false
      });
    }

    const startedAt = Date.now();

    try {
      // We keep the request schema generic here because the exact live endpoint can vary.
      const result = await retry(
        () =>
          fetchJsonDetailed<ElevenLabsGenerationResponse>(
            settings.apiUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "xi-api-key": settings.apiKey
              },
              body: JSON.stringify({
                model: context.resolvedModel,
                prompt: composePrompt(
                  context.request.prompt,
                  context.request.negativePrompt,
                  context.resolvedStyle
                ),
                size: context.resolvedSize,
                quality: context.resolvedQuality,
                style: context.resolvedStyle,
                negative_prompt: context.request.negativePrompt?.trim() || undefined,
                n: clampImageCount(context.request.count, capabilities.maxImagesPerRequest)
              })
            },
            context.timeoutMs
          ),
        2
      );

      // Normalize whichever image field variant the endpoint returned.
      const images = normalizeGenericImages(result.data, context.resolvedSize);
      if (images.length === 0) {
        throw createAiProviderError({
          provider: "eleven_labs",
          code: "empty_response",
          message: "ElevenLabs returned no images.",
          status: null,
          retryable: true
        });
      }

      return {
        provider: "eleven_labs",
        model: context.resolvedModel,
        prompt: context.request.prompt,
        latencyMs: Date.now() - startedAt,
        images,
        rateLimit: result.rateLimit
      };
    } catch (error) {
      // Preserve a shared error contract so fallback logic does not care which provider failed.
      throw normalizeProviderFailure("eleven_labs", error, "ElevenLabs image generation failed.");
    }
  }
};
