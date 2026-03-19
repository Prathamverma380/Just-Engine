import { AI_SETTINGS, FEATURE_FLAGS } from "../config";
import type { ImageIntent } from "../types/wallpaper";
import type { ImageIntentDetection } from "./types";

// These keyword groups are intentionally cheap heuristics.
// We only want to distinguish "search for an existing image" from "generate a new image".
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

function containsAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

// `auto` mode uses a small scorecard:
// enough descriptive signals -> generate
// otherwise -> keep the normal provider search path
export function detectImageIntent(query: string, intent: ImageIntent = "auto"): ImageIntentDetection {
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  if (intent === "search") {
    return {
      requestedIntent: intent,
      resolvedIntent: "search",
      score: 0,
      signals: ["explicit-search"]
    };
  }

  if (intent === "generate") {
    return {
      requestedIntent: intent,
      resolvedIntent: "generate",
      score: 100,
      signals: ["explicit-generate"]
    };
  }

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

  if (words.length >= AI_SETTINGS.promptWordThreshold) {
    score += 1;
    signals.push("prompt-length");
  }

  if (words.length >= AI_SETTINGS.promptWordThreshold + 3) {
    score += 1;
    signals.push("extra-detail");
  }

  if (containsAny(normalized, COMPOSITION_WORDS)) {
    score += 1;
    signals.push("composition");
  }

  if (containsAny(normalized, STYLE_WORDS)) {
    score += 1;
    signals.push("style");
  }

  if (containsAny(normalized, CAMERA_LIGHTING_WORDS)) {
    score += 1;
    signals.push("camera-lighting");
  }

  if (containsAny(normalized, GENERATION_VERBS)) {
    score += 1;
    signals.push("generation-verb");
  }

  if (ASPECT_RATIO_PATTERN.test(normalized)) {
    score += 1;
    signals.push("aspect-ratio");
  }

  if (NEGATIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    score += 1;
    signals.push("negative-prompt");
  }

  return {
    requestedIntent: intent,
    resolvedIntent: score >= 2 ? "generate" : "search",
    score,
    signals
  };
}

export function isDetailedGenerationPrompt(query: string, intent: ImageIntent = "auto"): boolean {
  return detectImageIntent(query, intent).resolvedIntent === "generate";
}
