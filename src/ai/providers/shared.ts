import type {
  AiGeneratedImage,
  AiProviderErrorCode,
  AiProviderErrorShape,
  AiProviderName
} from "../types";

// Shared provider helpers.
// These utilities are used by multiple provider adapters so common logic stays consistent.

type CompatibleImagePayload = {
  url?: string;
  b64_json?: string;
  mime_type?: string;
  revised_prompt?: string;
};

// Rich provider error object.
// The wrapper normalizes raw failures into this shape before deciding whether to continue fallback.
export class AiProviderError extends Error implements AiProviderErrorShape {
  readonly provider: AiProviderName;
  readonly code: AiProviderErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(input: AiProviderErrorShape) {
    super(input.message);
    this.name = "AiProviderError";
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.cause = input.cause;
    if (input.details) {
      this.details = input.details;
    }
  }
}

// Tiny factory so call sites stay readable.
export function createAiProviderError(input: AiProviderErrorShape): AiProviderError {
  return new AiProviderError(input);
}

// Builds the effective prompt string sent to upstream providers.
// Style and negative prompts are folded into text for providers that do not expose native fields.
export function composePrompt(prompt: string, negativePrompt?: string, style?: string): string {
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

// Converts a size string like `1024x1536` into explicit dimensions.
export function parseDimensions(size: string): { width: number; height: number } {
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

// Wraps raw base64 output in a browser-usable `data:` URL.
export function buildImageDataUrl(base64: string, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${base64}`;
}

// Converts one OpenAI-compatible image payload into the shared `AiGeneratedImage` shape.
export function normalizeCompatibleImage(
  provider: AiProviderName,
  image: CompatibleImagePayload,
  size: string
): AiGeneratedImage {
  const url = image.url?.trim()
    ? image.url.trim()
    : image.b64_json?.trim()
      ? buildImageDataUrl(image.b64_json.trim(), image.mime_type?.trim() || "image/png")
      : "";

  if (!url) {
    throw createAiProviderError({
      provider,
      code: "empty_response",
      message: `${provider} returned an image item without a usable url or base64 payload.`,
      status: null,
      retryable: true
    });
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

// Batch normalizer for OpenAI-compatible image arrays.
export function normalizeCompatibleImages(
  provider: AiProviderName,
  images: CompatibleImagePayload[] | undefined,
  size: string
): AiGeneratedImage[] {
  return (images ?? []).map((image) => normalizeCompatibleImage(provider, image, size));
}

// Provider-safe image count clamp used by adapters and the wrapper.
export function clampImageCount(count: number | undefined, maxImages: number): number {
  return Math.min(Math.max(1, count ?? 1), maxImages);
}

// Converts unknown thrown errors into normalized provider errors with retry hints.
export function normalizeProviderFailure(
  provider: AiProviderName,
  error: unknown,
  fallbackMessage: string
): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/\bHTTP (\d{3})\b/i);
  const status = statusMatch ? Number(statusMatch[1]) : null;

  if (status === 401 || status === 403) {
    return createAiProviderError({
      provider,
      code: "authentication_failed",
      message,
      status,
      retryable: false,
      cause: error
    });
  }

  if (status === 429) {
    return createAiProviderError({
      provider,
      code: "rate_limited",
      message,
      status,
      retryable: true,
      cause: error
    });
  }

  if (status !== null && status >= 400 && status < 500) {
    return createAiProviderError({
      provider,
      code: "invalid_request",
      message,
      status,
      retryable: false,
      cause: error
    });
  }

  return createAiProviderError({
    provider,
    code: "upstream_failure",
    message: message || fallbackMessage,
    status,
    retryable: true,
    cause: error
  });
}
