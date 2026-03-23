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
  composePrompt,
  createAiProviderError,
  normalizeProviderFailure,
  parseDimensions
} from "./shared";

// Nano Banana / Gemini image adapter.
// This provider uses Google's `generateContent` flow and expects image bytes in `inlineData`.

type GeminiInlineData = {
  data?: string;
  mimeType?: string;
  mime_type?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

// Gemini image generation currently behaves more like one-image-at-a-time generation.
const capabilities: AiProviderCapabilities = {
  supportsStyle: true,
  supportsNegativePrompt: true,
  maxImagesPerRequest: 1,
  outputMode: "base64",
  supportsSupabasePersistence: true
};

// Aspect ratios supported by the image config layer.
// Requests are snapped to the closest supported ratio so callers can still ask using free-form sizes.
const SUPPORTED_ASPECT_RATIOS: ReadonlyArray<readonly [string, number]> = [
  ["1:1", 1],
  ["9:16", 9 / 16],
  ["16:9", 16 / 9],
  ["2:3", 2 / 3],
  ["3:2", 3 / 2],
  ["3:4", 3 / 4],
  ["4:3", 4 / 3],
  ["4:5", 4 / 5],
  ["5:4", 5 / 4],
  ["21:9", 21 / 9],
  ["9:21", 9 / 21],
  ["1:4", 1 / 4],
  ["4:1", 4],
  ["1:8", 1 / 8],
  ["8:1", 8]
];

// Builds the final `.../models/<model>:generateContent` URL from the configured API base.
function buildEndpoint(apiUrl: string, model: string): string {
  const normalized = apiUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith(":generateContent")) {
    return normalized;
  }

  return `${normalized}/${encodeURIComponent(model)}:generateContent`;
}

// Maps a width/height pair to the closest aspect ratio that Gemini accepts.
function inferAspectRatio(size: string): string {
  const dimensions = parseDimensions(size);
  const ratio = dimensions.width / dimensions.height;
  let winner = SUPPORTED_ASPECT_RATIOS[0] ?? ["1:1", 1];
  let delta = Math.abs(winner[1] - ratio);

  for (const candidate of SUPPORTED_ASPECT_RATIOS.slice(1)) {
    const candidateDelta = Math.abs(candidate[1] - ratio);
    if (candidateDelta < delta) {
      winner = candidate;
      delta = candidateDelta;
    }
  }

  return winner[0];
}

// Some Gemini 3 image models expose coarse image-size tiers instead of arbitrary dimensions.
// For older/stable models we leave this unset.
function inferImageSize(model: string, size: string): string | null {
  if (!model.startsWith("gemini-3")) {
    return null;
  }

  const dimensions = parseDimensions(size);
  const longestSide = Math.max(dimensions.width, dimensions.height);

  if (longestSide <= 768) {
    return "0.5K";
  }

  if (longestSide <= 1280) {
    return "1K";
  }

  if (longestSide <= 2304) {
    return "2K";
  }

  return "4K";
}

// Converts Gemini `inlineData` image parts into the shared normalized image list.
function normalizeGeminiImages(response: GeminiGenerateContentResponse, size: string): AiGeneratedImage[] {
  const dimensions = parseDimensions(size);
  const textParts = (response.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text?.trim())
    .filter((part): part is string => Boolean(part));

  return (response.candidates ?? []).flatMap((candidate) =>
    (candidate.content?.parts ?? []).flatMap((part) => {
      const inlineData = part.inlineData ?? part.inline_data;
      const data = inlineData?.data?.trim();
      if (!data) {
        return [];
      }

      const image: AiGeneratedImage = {
        url: buildImageDataUrl(data, inlineData?.mimeType?.trim() || inlineData?.mime_type?.trim() || "image/png"),
        width: dimensions.width,
        height: dimensions.height
      };
      const revisedPrompt = textParts[0];
      if (revisedPrompt) {
        image.revisedPrompt = revisedPrompt;
      }
      return [image];
    })
  );
}

export const nanoBananaProvider: AiProviderAdapter = {
  name: "nano_banana",
  capabilities,
  // Nano Banana is considered configured only when enabled and both key + base URL are present.
  isConfigured(): boolean {
    const settings = AI_PROVIDER_SETTINGS.nano_banana;
    return settings.enabled && settings.apiKey.trim().length > 0 && settings.apiUrl.trim().length > 0;
  },
  // Executes one Gemini image-generation request and returns normalized images.
  async generate(context: AiProviderRequestContext): Promise<AiProviderGenerationResult> {
    const settings = AI_PROVIDER_SETTINGS.nano_banana;

    if (!settings.enabled) {
      throw createAiProviderError({
        provider: "nano_banana",
        code: "disabled",
        message: "Nano Banana image generation is disabled.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiKey.trim()) {
      throw createAiProviderError({
        provider: "nano_banana",
        code: "missing_credentials",
        message: "Nano Banana image generation is not configured: missing GEMINI_API_KEY.",
        status: null,
        retryable: false
      });
    }

    if (!settings.apiUrl.trim()) {
      throw createAiProviderError({
        provider: "nano_banana",
        code: "missing_endpoint",
        message: "Nano Banana image generation is not configured: missing endpoint.",
        status: null,
        retryable: false
      });
    }

    const aspectRatio = inferAspectRatio(context.resolvedSize);
    const imageSize = inferImageSize(context.resolvedModel, context.resolvedSize);
    const startedAt = Date.now();

    try {
      // Gemini generation uses `contents` + `generationConfig`, not the OpenAI images schema.
      const result = await retry(
        () =>
          fetchJsonDetailed<GeminiGenerateContentResponse>(
            buildEndpoint(settings.apiUrl, context.resolvedModel),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": settings.apiKey
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: composePrompt(
                          context.request.prompt,
                          context.request.negativePrompt,
                          context.resolvedStyle
                        )
                      }
                    ]
                  }
                ],
                generationConfig: {
                  responseModalities: ["Image"],
                  imageConfig: {
                    aspectRatio,
                    ...(imageSize ? { imageSize } : {})
                  }
                }
              })
            },
            context.timeoutMs
          ),
        2
      );

      // The provider returns nested candidates/parts; this flattens them into one shared image list.
      const images = normalizeGeminiImages(result.data, context.resolvedSize);
      if (images.length === 0) {
        throw createAiProviderError({
          provider: "nano_banana",
          code: "empty_response",
          message: "Nano Banana returned no images.",
          status: null,
          retryable: true
        });
      }

      return {
        provider: "nano_banana",
        model: context.resolvedModel,
        prompt: context.request.prompt,
        latencyMs: Date.now() - startedAt,
        images,
        rateLimit: result.rateLimit
      };
    } catch (error) {
      // Convert raw Google API failures into the shared provider-error shape used by fallback logic.
      throw normalizeProviderFailure("nano_banana", error, "Nano Banana image generation failed.");
    }
  }
};
