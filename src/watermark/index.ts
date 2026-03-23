import { ensureDataDirectory } from "../persistence";
import type {
  Wallpaper,
  WallpaperDeliveryMode,
  WallpaperDeliveryTier,
  WallpaperVariant
} from "../types/wallpaper";

declare function require(name: string): any;

// Watermark delivery stays separate from providers and search routing.
// This module owns the free-tier derivative lifecycle end to end.
// The flow here is intentionally linear:
// source image -> fetched bytes -> SVG overlay -> cached free-tier asset -> delivery-aware wallpaper url

// These are the variants that can be transformed without changing the shared wallpaper contract.
const WATERMARK_VARIANTS: WallpaperVariant[] = ["thumbnail", "preview", "full", "original"];
// Bump this when the visual watermark treatment changes so cache keys naturally rotate.
const DEFAULT_WATERMARK_VERSION = "v1";
// We still make one live fetch to read the original image, so keep that step bounded.
const WATERMARK_FETCH_TIMEOUT_MS = 15000;

// Public input for delivery-aware callers.
// `tier` decides whether we keep the provider url or generate a free-tier derivative.
export interface WallpaperDeliveryOptions {
  tier?: WallpaperDeliveryTier;
  variants?: WallpaperVariant[];
  watermarkVersion?: string;
  watermarkText?: string;
  watermarkSubtext?: string;
  forceRefresh?: boolean;
}

// Internal return shape from the cache worker.
// Filesystem callers use `filePath`; URL-based callers use `dataUrl`.
interface CachedWatermarkAsset {
  filePath: string;
  dataUrl: string;
}

// Small deterministic hash used only for stable cache filenames.
function deterministicHash(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

// Strings are embedded inside SVG markup, so they must be XML-safe first.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Converts downloaded source bytes into a self-contained base64 payload for the SVG wrapper.
function toBase64(buffer: Uint8Array): string {
  const { Buffer } = require("node:buffer");
  return Buffer.from(buffer).toString("base64");
}

// Keeps the rest of the engine on the same "url string" contract even for generated watermark assets.
function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// Default brand label shown on free-tier derivatives.
function defaultWatermarkText(): string {
  return "JUST ENGINE FREE";
}

// Secondary label derived from the wallpaper itself so callers do not have to provide one every time.
function defaultWatermarkSubtext(wallpaper: Wallpaper): string {
  return `${wallpaper.category.toUpperCase()} PREVIEW`;
}

// Delivery defaults to premium/original unless a caller explicitly asks for free-tier output.
function normalizeTier(tier: WallpaperDeliveryTier | undefined): WallpaperDeliveryTier {
  return tier === "free" ? "free" : "premium";
}

// Central mapping from subscription-like tier to actual delivery behavior.
function resolveDeliveryMode(tier: WallpaperDeliveryTier): WallpaperDeliveryMode {
  return tier === "free" ? "watermarked" : "original";
}

// Callers may request a subset of variants; this helper removes duplicates and invalid values.
function normalizeVariants(variants: WallpaperVariant[] | undefined): WallpaperVariant[] {
  if (!variants || variants.length === 0) {
    return [...WATERMARK_VARIANTS];
  }

  return Array.from(new Set(variants.filter((variant): variant is WallpaperVariant => WATERMARK_VARIANTS.includes(variant))));
}

// Thumbnail and preview assets can use smaller dimensions than the original image.
// That keeps free-tier derivatives lighter while preserving the original/full sizes when needed.
function getVariantDimensions(wallpaper: Wallpaper, variant: WallpaperVariant): { width: number; height: number } {
  const width = wallpaper.metadata.width > 0 ? wallpaper.metadata.width : 1080;
  const height = wallpaper.metadata.height > 0 ? wallpaper.metadata.height : 1920;

  if (variant === "thumbnail") {
    return {
      width: Math.max(320, Math.round(width / 4)),
      height: Math.max(568, Math.round(height / 4))
    };
  }

  if (variant === "preview") {
    return {
      width: Math.max(720, Math.round(width / 2)),
      height: Math.max(1280, Math.round(height / 2))
    };
  }

  return {
    width,
    height
  };
}

// Builds the actual SVG overlay around the original image bytes.
// The image is embedded directly into the SVG so the cached artifact is portable and self-contained.
function buildWatermarkSvg(input: {
  wallpaper: Wallpaper;
  variant: WallpaperVariant;
  width: number;
  height: number;
  imageDataUrl: string;
  watermarkText: string;
  watermarkSubtext: string;
}): string {
  const title = escapeXml(input.watermarkText);
  const subtitle = escapeXml(input.watermarkSubtext);
  const description = escapeXml(input.wallpaper.metadata.description);
  const category = escapeXml(input.wallpaper.category);
  const imageHref = escapeXml(input.imageDataUrl);
  const badgeWidth = Math.max(280, Math.round(input.width * 0.28));
  const badgeHeight = Math.max(88, Math.round(input.height * 0.065));
  const badgeX = Math.max(24, Math.round(input.width * 0.04));
  const badgeY = Math.max(24, Math.round(input.height * 0.04));
  const patternWidth = Math.max(260, Math.round(input.width * 0.2));
  const patternHeight = Math.max(180, Math.round(input.height * 0.12));
  const footerHeight = Math.max(170, Math.round(input.height * 0.12));

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">
      <defs>
        <linearGradient id="overlay-scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0a0f19" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#0a0f19" stop-opacity="0.28" />
        </linearGradient>
        <pattern id="watermark-grid" width="${patternWidth}" height="${patternHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(-22)">
          <text x="0" y="52" fill="#ffffff" fill-opacity="0.24" font-size="28" font-weight="700" font-family="Arial, sans-serif">${title}</text>
          <text x="0" y="88" fill="#ffffff" fill-opacity="0.18" font-size="16" font-weight="500" font-family="Arial, sans-serif">${subtitle}</text>
        </pattern>
        <filter id="badge-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.28" />
        </filter>
      </defs>
      <image href="${imageHref}" width="${input.width}" height="${input.height}" preserveAspectRatio="xMidYMid slice" />
      <rect width="${input.width}" height="${input.height}" fill="url(#overlay-scrim)" />
      <rect width="${input.width}" height="${input.height}" fill="url(#watermark-grid)" />
      <g filter="url(#badge-shadow)">
        <rect x="${badgeX}" y="${badgeY}" rx="20" ry="20" width="${badgeWidth}" height="${badgeHeight}" fill="#09101c" fill-opacity="0.78" stroke="#ffffff" stroke-opacity="0.24" />
        <text x="${badgeX + 26}" y="${badgeY + 36}" fill="#ffffff" font-size="26" font-weight="700" font-family="Arial, sans-serif">${title}</text>
        <text x="${badgeX + 26}" y="${badgeY + 64}" fill="#ffffff" fill-opacity="0.8" font-size="15" font-weight="500" font-family="Arial, sans-serif">${subtitle}</text>
      </g>
      <g>
        <rect x="0" y="${Math.max(0, input.height - footerHeight)}" width="${input.width}" height="${footerHeight}" fill="#070b13" fill-opacity="0.3" />
        <text x="${Math.max(28, Math.round(input.width * 0.04))}" y="${Math.max(0, input.height - Math.max(90, Math.round(input.height * 0.06)))}" fill="#ffffff" font-size="${Math.max(24, Math.round(input.height * 0.018))}" font-weight="700" font-family="Arial, sans-serif">${description}</text>
        <text x="${Math.max(28, Math.round(input.width * 0.04))}" y="${Math.max(0, input.height - Math.max(48, Math.round(input.height * 0.03)))}" fill="#ffffff" fill-opacity="0.78" font-size="${Math.max(16, Math.round(input.height * 0.012))}" font-weight="500" font-family="Arial, sans-serif">${category} • ${escapeXml(input.variant)} • free tier</text>
      </g>
    </svg>
  `.trim();
}

// Cache identity depends on the source asset, requested variant, and the exact watermark design inputs.
function buildWatermarkCacheKey(
  wallpaper: Wallpaper,
  variant: WallpaperVariant,
  options: WallpaperDeliveryOptions
): string {
  return deterministicHash(
    [
      wallpaper.id,
      variant,
      wallpaper.urls[variant],
      options.watermarkVersion ?? DEFAULT_WATERMARK_VERSION,
      options.watermarkText ?? defaultWatermarkText(),
      options.watermarkSubtext ?? defaultWatermarkSubtext(wallpaper)
    ].join("::")
  );
}

// Free-tier watermark files live in their own directory tree to avoid any chance of colliding with original caches.
function getWatermarkDirectory(tier: WallpaperDeliveryTier, variant: WallpaperVariant): string {
  const path = require("path");
  return ensureDataDirectory(path.join("watermarks", tier, variant));
}

// Cheap cache lookup helper used by tests and future API code that wants the on-disk derivative path.
export function getCachedWatermarkPath(
  wallpaper: Wallpaper,
  variant: WallpaperVariant = "preview",
  options: WallpaperDeliveryOptions = {}
): string | null {
  if (normalizeTier(options.tier) !== "free") {
    return null;
  }

  try {
    const fs = require("fs");
    const path = require("path");
    const key = buildWatermarkCacheKey(wallpaper, variant, options);
    const directory = getWatermarkDirectory("free", variant);
    const filePath = path.join(directory, `${wallpaper.id}_${key}.svg`);
    return fs.existsSync(filePath) ? path.normalize(filePath) : null;
  } catch {
    return null;
  }
}

// Fetches the original provider asset so watermark generation can wrap real image bytes.
async function fetchSourceImage(url: string): Promise<{ buffer: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WATERMARK_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch source image for watermarking: HTTP ${response.status}`);
    }

    return {
      buffer: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.trim() || "image/jpeg"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Main cache worker:
// 1. build the deterministic file path
// 2. reuse the cached SVG when present
// 3. otherwise fetch the source image and generate a new watermarked derivative
async function ensureWatermarkedVariant(
  wallpaper: Wallpaper,
  variant: WallpaperVariant,
  options: WallpaperDeliveryOptions
): Promise<CachedWatermarkAsset> {
  const fs = require("fs");
  const path = require("path");
  const cacheKey = buildWatermarkCacheKey(wallpaper, variant, options);
  const directory = getWatermarkDirectory("free", variant);
  const filePath = path.join(directory, `${wallpaper.id}_${cacheKey}.svg`);

  if (!options.forceRefresh && fs.existsSync(filePath)) {
    const cachedSvg = fs.readFileSync(filePath, "utf8");
    return {
      filePath: path.normalize(filePath),
      dataUrl: toSvgDataUrl(cachedSvg)
    };
  }

  const sourceUrl = wallpaper.urls[variant];
  const { buffer, contentType } = await fetchSourceImage(sourceUrl);
  const imageDataUrl = `data:${contentType};base64,${toBase64(buffer)}`;
  const { width, height } = getVariantDimensions(wallpaper, variant);
  const svg = buildWatermarkSvg({
    wallpaper,
    variant,
    width,
    height,
    imageDataUrl,
    watermarkText: options.watermarkText ?? defaultWatermarkText(),
    watermarkSubtext: options.watermarkSubtext ?? defaultWatermarkSubtext(wallpaper)
  });

  fs.writeFileSync(filePath, svg, "utf8");

  return {
    filePath: path.normalize(filePath),
    dataUrl: toSvgDataUrl(svg)
  };
}

// Public delivery resolver.
// Premium returns the original provider url; free returns a generated watermark data URL.
export async function getDeliveredWallpaperUrl(
  wallpaper: Wallpaper,
  variant: WallpaperVariant = "preview",
  options: WallpaperDeliveryOptions = {}
): Promise<string> {
  const tier = normalizeTier(options.tier);

  if (resolveDeliveryMode(tier) === "original") {
    return wallpaper.urls[variant];
  }

  const asset = await ensureWatermarkedVariant(wallpaper, variant, options);
  return asset.dataUrl;
}

// Produces a wallpaper object that already matches the requested delivery tier.
// This is the clean integration point for future monetization gates in the engine/API layer.
export async function prepareWallpaperForDelivery(
  wallpaper: Wallpaper,
  options: WallpaperDeliveryOptions = {}
): Promise<Wallpaper> {
  const tier = normalizeTier(options.tier);
  const mode = resolveDeliveryMode(tier);
  const transformedVariants = normalizeVariants(options.variants);

  if (mode === "original") {
    return {
      ...wallpaper,
      delivery: {
        tier,
        mode,
        isWatermarked: false,
        watermarkVersion: null,
        transformedVariants: []
      }
    };
  }

  const urls: Wallpaper["urls"] = {
    ...wallpaper.urls
  };

  for (const variant of transformedVariants) {
    urls[variant] = await getDeliveredWallpaperUrl(wallpaper, variant, options);
  }

  return {
    ...wallpaper,
    urls,
    delivery: {
      tier,
      mode,
      isWatermarked: true,
      watermarkVersion: options.watermarkVersion ?? DEFAULT_WATERMARK_VERSION,
      transformedVariants
    }
  };
}

// Shared export so callers can key cache/version logic off one source of truth.
export function getDefaultWatermarkVersion(): string {
  return DEFAULT_WATERMARK_VERSION;
}
