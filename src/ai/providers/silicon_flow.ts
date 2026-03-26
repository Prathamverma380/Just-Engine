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
  normalizeProviderFailure,
  parseDimensions
} from "./shared";

type SiliconFlowGenerationResponse = {
  images?: Array<{
    url?: string;
  }>;
};

const capabilities: AiProviderCapabilities = {
  supportsStyle: true,
  supportsNegativePrompt: true,
  maxImagesPerRequest: 4,
  outputMode: "url",
  supportsSupabasePersistence: true
};

const KOLORS_IMAGE_SIZES = ["1024x1024", "960x1280", "768x1024", "720x1440", "720x1280"] as const;
const QWEN_IMAGE_SIZES = ["1328x1328", "1664x928", "928x1664", "1472x1140", "1140x1472", "1584x1056", "1056x1584"] as const;

function supportsBatchSize(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "kwai-kolors/kolors" || normalized === "qwen/qwen-image";
}

function requiresImageInput(model: string): boolean {
  return /^qwen\/qwen-image-edit(?:-\d+)?$/i.test(model.trim());
}

function getSupportedImageSizes(model: string): readonly string[] | null {
  const normalized = model.trim().toLowerCase();

  if (normalized === "kwai-kolors/kolors") {
    return KOLORS_IMAGE_SIZES;
  }

  if (normalized === "qwen/qwen-image") {
    return QWEN_IMAGE_SIZES;
  }

  return null;
}

function getImageSizeScore(requestedSize: string, candidateSize: string): number {
  const requested = parseDimensions(requestedSize);
  const candidate = parseDimensions(candidateSize);
  const requestedRatio = requested.width / requested.height;
  const candidateRatio = candidate.width / candidate.height;
  const ratioDelta = Math.abs(requestedRatio - candidateRatio);
  const areaDelta = Math.abs(requested.width * requested.height - candidate.width * candidate.height);

  return ratioDelta * 10_000_000 + areaDelta;
}

function resolveImageSize(model: string, requestedSize: string): string {
  const supportedSizes = getSupportedImageSizes(model);
  if (!supportedSizes || supportedSizes.includes(requestedSize)) {
    return requestedSize;
  }

  const [firstSupportedSize, ...remainingSupportedSizes] = supportedSizes;
  if (!firstSupportedSize) {
    return requestedSize;
  }

  let winner = firstSupportedSize;
  let winnerScore = getImageSizeScore(requestedSize, winner);

  for (const candidate of remainingSupportedSizes) {
    const candidateScore = getImageSizeScore(requestedSize, candidate);
    if (candidateScore < winnerScore) {
      winner = candidate;
      winnerScore = candidateScore;
    }
  }

  return winner;
}

export const siliconFlowProvider: AiProviderAdapter = {
  name: "silicon_flow",
  capabilities,
  isConfigured(): boolean {
    const settings = AI_PROVIDER_SETTINGS.silicon_flow;
    return settings.enabled && settings.apiKey.trim().length > 0 && settings.apiUrl.trim().length > 0;
  },
  async generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult> {
    const settings = AI_PROVIDER_SETTINGS.silicon_flow;

    if (!settings.enabled) {
      throw createAiProviderError({
        provider: "silicon_flow",
        code: "disabled",
        message: "SiliconFlow image generation is disabled.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiKey.trim()) {
      throw createAiProviderError({
        provider: "silicon_flow",
        code: "missing_credentials",
        message: "SiliconFlow image generation is not configured: missing API key.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiUrl.trim()) {
      throw createAiProviderError({
        provider: "silicon_flow",
        code: "missing_endpoint",
        message: "SiliconFlow image generation is not configured: missing SILICONFLOW_IMAGE_API_URL.",
        status: null,
        retryable: false
      });
    }

    if (requiresImageInput(context.resolvedModel)) {
      throw createAiProviderError({
        provider: "silicon_flow",
        code: "invalid_request",
        message: "SiliconFlow image-edit models require input images and are not supported by this adapter.",
        status: null,
        retryable: false
      });
    }

    const imageSize = resolveImageSize(context.resolvedModel, context.resolvedSize);
    const startedAt = Date.now();

    try {
      const result = await retry(
        () =>
          fetchJsonDetailed<SiliconFlowGenerationResponse>(
            settings.apiUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.apiKey}`
              },
              body: JSON.stringify({
                model: context.resolvedModel,
                prompt: composePrompt(context.request.prompt, undefined, context.resolvedStyle),
                image_size: imageSize,
                ...(context.request.negativePrompt?.trim()
                  ? {
                      negative_prompt: context.request.negativePrompt.trim()
                    }
                  : {}),
                ...(supportsBatchSize(context.resolvedModel)
                  ? {
                      batch_size: clampImageCount(context.request.count, capabilities.maxImagesPerRequest)
                    }
                  : {})
              })
            },
            context.timeoutMs
          ),
        2
      );

      const images = normalizeCompatibleImages("silicon_flow", result.data.images, imageSize);
      if (images.length === 0) {
        throw createAiProviderError({
          provider: "silicon_flow",
          code: "empty_response",
          message: "SiliconFlow returned no images.",
          status: null,
          retryable: true
        });
      }

      return {
        provider: "silicon_flow",
        model: context.resolvedModel,
        prompt: context.request.prompt,
        latencyMs: Date.now() - startedAt,
        images,
        rateLimit: result.rateLimit
      };
    } catch (error) {
      throw normalizeProviderFailure("silicon_flow", error, "SiliconFlow image generation failed.");
    }
  }
};
