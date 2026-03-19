import { AI_SETTINGS, FEATURE_FLAGS } from "../config";
import { fetchJsonDetailed, retry } from "../utils";
import type { AiGeneratedImage, AiGenerationRequest, AiGenerationResponse } from "./types";

// The wrapper accepts a generic OpenAI-compatible image generation response:
// either hosted URLs or base64 payloads.
type CompatibleImagePayload = {
  url?: string;
  b64_json?: string;
  mime_type?: string;
  revised_prompt?: string;
};

type CompatibleGenerationResponse = {
  data?: CompatibleImagePayload[];
};

type GenerationOverride = (request: AiGenerationRequest) => Promise<AiGenerationResponse>;

// Tests can inject a fake generator so we can verify routing without a live AI provider.
let generationOverrideForTests: GenerationOverride | null = null;

// We keep style and negative prompts in the public API even though providers differ.
// For OpenAI's current Images API, `style` is not a supported top-level request field,
// so we fold it into the prompt text instead of sending an unsupported parameter.
function composePrompt(prompt: string, negativePrompt?: string, style?: string): string {
  const trimmedPrompt = prompt.trim();
  const trimmedNegative = negativePrompt?.trim();
  const trimmedStyle = style?.trim();

  const sections = [trimmedPrompt];

  if (trimmedStyle) {
    sections.push(`Style preference: ${trimmedStyle}`);
  }

  if (trimmedNegative) {
    sections.push(`Avoid: ${trimmedNegative}`);
  }

  return sections.join("\n\n");
}

function parseDimensions(size: string): { width: number; height: number } {
  const match = size.trim().match(/^(\d{2,4})x(\d{2,4})$/i);
  if (!match) {
    return {
      width: 1024,
      height: 1024
    };
  }

  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

// Normalizes either a hosted image URL or a base64 image into one consistent shape for the engine.
function normalizeGeneratedImage(
  image: CompatibleImagePayload,
  size: string
): AiGeneratedImage {
  const url = image.url?.trim()
    ? image.url.trim()
    : image.b64_json?.trim()
      ? `data:${image.mime_type?.trim() || "image/png"};base64,${image.b64_json.trim()}`
      : "";

  if (!url) {
    throw new Error("AI image wrapper returned an image item without a usable url or base64 payload.");
  }

  const dimensions = parseDimensions(size);

  const normalized: AiGeneratedImage = {
    url,
    width: dimensions.width,
    height: dimensions.height
  };

  if (image.mime_type?.trim()) {
    normalized.mimeType = image.mime_type.trim();
  }

  if (image.revised_prompt?.trim()) {
    normalized.revisedPrompt = image.revised_prompt.trim();
  }

  return normalized;
}

export function setGenerateImageOverrideForTests(override: GenerationOverride | null): void {
  generationOverrideForTests = override;
}

// This is the single provider-facing generation entry point.
// The engine calls this and never needs to know whether the upstream returned URLs or base64.
export async function generateImage(request: AiGenerationRequest): Promise<AiGenerationResponse> {
  if (generationOverrideForTests) {
    return generationOverrideForTests(request);
  }

  if (!FEATURE_FLAGS.enableAiGeneration) {
    throw new Error("AI image generation is disabled by feature flag.");
  }

  if (!AI_SETTINGS.apiKey.trim()) {
    throw new Error("AI image generation is not configured: missing AI_IMAGE_API_KEY.");
  }

  const endpoint = AI_SETTINGS.apiUrl.trim();
  if (!endpoint) {
    throw new Error("AI image generation is not configured: missing AI_IMAGE_API_URL.");
  }

  const model = request.model?.trim() || AI_SETTINGS.defaultModel;
  const size = request.size?.trim() || AI_SETTINGS.defaultSize;
  const quality = request.quality?.trim() || AI_SETTINGS.defaultQuality;
  const style = request.style?.trim() || AI_SETTINGS.defaultStyle;
  const count = Math.min(Math.max(1, request.count ?? 1), AI_SETTINGS.maxImagesPerRequest);
  const startedAt = Date.now();

  const response = await retry(
    async () =>
      fetchJsonDetailed<CompatibleGenerationResponse>(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_SETTINGS.apiKey}`
          },
          body: JSON.stringify({
            model,
            prompt: composePrompt(request.prompt, request.negativePrompt, style),
            size,
            quality,
            n: count
          })
        },
        AI_SETTINGS.timeoutMs
      ),
    1
  );

  const images = (response.data.data ?? []).map((image) => normalizeGeneratedImage(image, size));
  if (images.length === 0) {
    throw new Error("AI image wrapper returned no images.");
  }

  return {
    provider: AI_SETTINGS.provider,
    model,
    prompt: request.prompt,
    latencyMs: Date.now() - startedAt,
    images
  };
}
