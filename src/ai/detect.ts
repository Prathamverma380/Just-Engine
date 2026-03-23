import { FEATURE_FLAGS } from "../config";
import { AI_SETTINGS } from "./config";
import type { ImageIntent } from "../types/wallpaper";
import type { ImageIntentDetection } from "./types";

// ---------------------------------------------------------------------------
// AI Prompt Intent Detection
// ---------------------------------------------------------------------------
// This file answers one routing question for the engine:
//
// "Does this user input look like a normal wallpaper search,
// or does it look like a prompt for generating a brand-new image?"
//
// It does NOT try to understand the prompt deeply.
// It does NOT call any model.
// It only applies a small set of cheap heuristics so the engine can route fast.
//
// A few examples:
// - "mountains"                         -> probably SEARCH
// - "dark amoled wallpaper"            -> probably SEARCH
// - "create anime girl portrait 9:16"  -> probably GENERATE
// - "cyberpunk city, no text, rim light" -> probably GENERATE
//
// Prompt-intent detection sits in front of the wrapper.
// Its job is not to judge image quality or deeply understand the prompt;
// it only decides whether the caller likely wants:
// 1. an existing wallpaper search, or
// 2. a newly generated image.

// These keyword groups are intentionally cheap heuristics.
// We only want to distinguish "search for an existing image" from "generating a new image".
const COMPOSITION_WORDS = [
  "portrait",
  "wide shot",
  "close-up",
  "close up",
  "full body",
  "macro",
  "background",
  "foreground",
  "centered",
  "symmetrical",
  "composition"
];

const STYLE_WORDS = [
  "cinematic",
  "photoreal",
  "photorealistic",
  "anime",
  "illustration",
  "watercolor",
  "oil painting",
  "pixel art",
  "3d render",
  "concept art",
  "minimalist"
];

const CAMERA_LIGHTING_WORDS = [
  "rim lighting",
  "soft light",
  "dramatic lighting",
  "golden hour",
  "bokeh",
  "depth of field",
  "lens",
  "shot on",
  "studio light",
  "volumetric"
];

const GENERATION_VERBS = ["generate", "create", "make", "design", "render", "illustrate"];
const NEGATIVE_PROMPT_PATTERNS = [/\bnegative prompt\b/i, /--no\b/i, /\bno text\b/i, /\bwithout text\b/i];
const ASPECT_RATIO_PATTERN = /\b(?:\d{1,2}:\d{1,2}|portrait|landscape|vertical|horizontal)\b/i;

// Small helper that keeps the scorecard readable.
// We only care whether any keyword from a group appears in the normalized prompt.
function containsAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

// `auto` mode uses a small scorecard:
// enough descriptive signals -> generate
// otherwise -> keep the normal provider search path
export function detectImageIntent(query: string, intent: ImageIntent = "auto"): ImageIntentDetection {
  // Normalize once up front so every later check uses the same cleaned text.
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  // Explicit caller intent always wins.
  // If the host already knows what it wants, we should not second-guess it.
  if (intent === "search") {
    return {
      requestedIntent: intent,
      resolvedIntent: "search",
      score: 0,
      signals: ["explicit-search"]
    };
  }

  // Explicit generate skips heuristics for the same reason.
  if (intent === "generate") {
    return {
      requestedIntent: intent,
      resolvedIntent: "generate",
      score: 100,
      signals: ["explicit-generate"]
    };
  }

  // Feature flag lets the app disable auto-detection globally and keep behavior predictable.
  if (!FEATURE_FLAGS.enableAutoPromptDetection) {
    return {
      requestedIntent: intent,
      resolvedIntent: "search",
      score: 0,
      signals: ["auto-detect-disabled"]
    };
  }

  let score = 0;
  const signals: string[] = [];

  // Longer prompts are more likely to be generation-style instructions than plain searches.
  // Example:
  // - "mountains" -> short, probably search
  // - "cinematic neon samurai portrait with rim lighting" -> longer, more likely generate
  if (words.length >= AI_SETTINGS.promptWordThreshold) {
    score += 1;
    signals.push("prompt-length");
  }

  // Very detailed prompts get an extra point because they usually describe composition or art direction.
  if (words.length >= AI_SETTINGS.promptWordThreshold + 3) {
    score += 1;
    signals.push("extra-detail");
  }

  // Composition language strongly suggests generation.
  // These are words about framing or layout, not just subject matter.
  if (containsAny(normalized, COMPOSITION_WORDS)) {
    score += 1;
    signals.push("composition");
  }

  // Art-style words are another strong generation signal.
  // If someone says "anime", "watercolor", or "concept art", they are usually directing creation.
  if (containsAny(normalized, STYLE_WORDS)) {
    score += 1;
    signals.push("style");
  }

  // Camera and lighting vocabulary also tends to appear in generative prompts.
  // These words mimic photography or rendering instructions.
  if (containsAny(normalized, CAMERA_LIGHTING_WORDS)) {
    score += 1;
    signals.push("camera-lighting");
  }

  // Direct verbs like "create" or "render" make intent much clearer.
  // This is one of the strongest hints because the user is literally asking the system to make something.
  if (containsAny(normalized, GENERATION_VERBS)) {
    score += 1;
    signals.push("generation-verb");
  }

  // Aspect ratio and orientation instructions are common in image generation.
  // Search queries do sometimes say "portrait wallpaper", so this is helpful but not enough on its own.
  if (ASPECT_RATIO_PATTERN.test(normalized)) {
    score += 1;
    signals.push("aspect-ratio");
  }

  // Negative prompt syntax is usually a dead giveaway that the user wants generation.
  // Phrases like "no text" or "--no logo" are common in prompt-engineering style input.
  if (NEGATIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    score += 1;
    signals.push("negative-prompt");
  }

  // The threshold is intentionally low: we only need enough confidence to route into generation.
  // Current rule:
  // - score 0 or 1 -> SEARCH
  // - score 2+     -> GENERATE
  //
  // We keep this simple so the behavior is predictable and easy to tune later.
  return {
    requestedIntent: intent,
    resolvedIntent: score >= 2 ? "generate" : "search",
    score,
    signals
  };
}

// Convenience wrapper for callers that only need a yes/no answer.
// This is just a tiny adapter around `detectImageIntent` for places where
// the score and signals do not matter.
export function isDetailedGenerationPrompt(query: string, intent: ImageIntent = "auto"): boolean {
  return detectImageIntent(query, intent).resolvedIntent === "generate";
}
