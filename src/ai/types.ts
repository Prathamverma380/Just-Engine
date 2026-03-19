import type { ImageIntent } from "../types/wallpaper";

// Shared contracts for the AI image-generation layer.
// The rest of the project should depend on these normalized shapes rather than
// any provider-specific request or response schema.

// Shared optional controls for image generation.
// These map cleanly to the knobs most image providers expose.
export interface AiGenerationOptions {
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  negativePrompt?: string;
  count?: number;
}

// The normalized request shape the engine passes into the AI wrapper.
// `prompt` is required, while provider-specific tuning stays in AiGenerationOptions.
export interface AiGenerationRequest extends AiGenerationOptions {
  // The user's original text prompt.
  prompt: string;
  // Category helps the engine preserve intent even though generation is prompt-first.
  category: string;
}

// One generated image after the wrapper has normalized the provider response.
// The wrapper may receive either hosted URLs or base64 data, but the engine only sees this shape.
export interface AiGeneratedImage {
  // Always normalized into one directly usable image URL or data URL.
  url: string;
  // Dimensions are derived from the request when the provider does not return them.
  width: number;
  height: number;
  // Optional MIME type when the provider returns base64 or explicit content metadata.
  mimeType?: string;
  // Some providers revise prompts; we preserve that for debugging or UX later.
  revisedPrompt?: string;
}

// The provider-agnostic result returned by the AI wrapper.
// This keeps the engine insulated from raw upstream response formats.
export interface AiGenerationResponse {
  // Human-readable provider label, useful for logging and future fallback routing.
  provider: string;
  // The model that actually served the image request.
  model: string;
  // Original input prompt before provider-specific adaptation.
  prompt: string;
  // Total provider call time in milliseconds.
  latencyMs: number;
  // One normalized array no matter what the upstream provider returned.
  images: AiGeneratedImage[];
}

// The output of the prompt-intent detector.
// `requestedIntent` is what the caller asked for; `resolvedIntent` is what the detector decided.
export interface ImageIntentDetection {
  // The mode the caller explicitly requested.
  requestedIntent: ImageIntent;
  // The final resolved route after applying auto-detection rules.
  resolvedIntent: "search" | "generate";
  // Lightweight heuristic score used only for debugging and operator visibility.
  score: number;
  // Named signals that explain why a prompt was treated as search or generation.
  signals: string[];
}
