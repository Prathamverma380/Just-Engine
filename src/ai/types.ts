import type { ImageIntent } from "../types/wallpaper";

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
  prompt: string;
  category: string;
}

// One generated image after the wrapper has normalized the provider response.
// The wrapper may receive either hosted URLs or base64 data, but the engine only sees this shape.
export interface AiGeneratedImage {
  url: string;
  width: number;
  height: number;
  mimeType?: string;
  revisedPrompt?: string;
}

// The provider-agnostic result returned by the AI wrapper.
// This keeps the engine insulated from raw upstream response formats.
export interface AiGenerationResponse {
  provider: string;
  model: string;
  prompt: string;
  latencyMs: number;
  images: AiGeneratedImage[];
}

// The output of the prompt-intent detector.
// `requestedIntent` is what the caller asked for; `resolvedIntent` is what the detector decided.
export interface ImageIntentDetection {
  requestedIntent: ImageIntent;
  resolvedIntent: "search" | "generate";
  score: number;
  signals: string[];
}
