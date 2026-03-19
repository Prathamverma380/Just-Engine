import { AI_SETTINGS, FEATURE_FLAGS } from "../config";
import { fetchJsonDetailed, retry } from "../utils";
import type { AiGeneratedImage, AiGenerationRequest, AiGenerationResponse } from "./types";

// This file is the provider-facing side of the AI module.
// The engine gives it one normalized generation request, and it:
// 1. applies config defaults
// 2. calls the upstream image API
// 3. converts the raw provider response into the shared internal shape

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

// Test hook shape used by the suite to bypass live provider calls.
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

// Providers often accept a single size string, but the engine wants explicit dimensions.
// We derive them once here so all generated images expose the same width/height fields.
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

  // The rest of the engine expects every generated image to be directly usable.
  // If the provider gives us neither a URL nor base64 payload, the response is invalid.
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

// Tests use this to replace the live provider call with a deterministic fake.
export function setGenerateImageOverrideForTests(override: GenerationOverride | null): void {
  generationOverrideForTests = override;
}

// This is the single provider-facing generation entry point.
// The engine calls this and never needs to know whether the upstream returned URLs or base64.
export async function generateImage(request: AiGenerationRequest): Promise<AiGenerationResponse> {
  // Test override is checked first so the suite never makes accidental live image requests.
  if (generationOverrideForTests) {
    return generationOverrideForTests(request);
  }

  // Hard guard so hosts can disable generation entirely without changing call sites.
  if (!FEATURE_FLAGS.enableAiGeneration) {
    throw new Error("AI image generation is disabled by feature flag.");
  }

  // Fail early on missing credentials rather than making a broken request.
  if (!AI_SETTINGS.apiKey.trim()) {
    throw new Error("AI image generation is not configured: missing AI_IMAGE_API_KEY.");
  }

  const endpoint = AI_SETTINGS.apiUrl.trim();
  // We keep the endpoint configurable so this wrapper can target compatible providers later.
  if (!endpoint) {
    throw new Error("AI image generation is not configured: missing AI_IMAGE_API_URL.");
  }

  // Resolve all provider knobs here so callers can omit them and still get a complete request.
  const model = request.model?.trim() || AI_SETTINGS.defaultModel;
  const size = request.size?.trim() || AI_SETTINGS.defaultSize;
  const quality = request.quality?.trim() || AI_SETTINGS.defaultQuality;
  const style = request.style?.trim() || AI_SETTINGS.defaultStyle;
  // Clamp count to the configured maximum so we do not ask the provider for unsupported batch sizes.
  const count = Math.min(Math.max(1, request.count ?? 1), AI_SETTINGS.maxImagesPerRequest);
  const startedAt = Date.now();

  // Shared retry wrapper gives us one place to apply timeout and transient failure behavior.
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
          // Request shape is intentionally kept generic and normalized in one place.
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

  // Convert the raw provider payload into the internal one-image shape used everywhere else.
  const images = (response.data.data ?? []).map((image) => normalizeGeneratedImage(image, size));

  // Empty success responses are treated as provider failures because the engine expects real output.
  if (images.length === 0) {
    throw new Error("AI image wrapper returned no images.");
  }

  // Final normalized response keeps provider details available without leaking raw upstream schema.
  return {
    provider: AI_SETTINGS.provider,
    model,
    prompt: request.prompt,
    latencyMs: Date.now() - startedAt,
    images
  };
}
