import { getAuthenticatedSession } from "../auth";
import { getSupabaseAuthConfig } from "../auth/config";
import { hashString } from "../utils";
import { AI_STORAGE_SETTINGS } from "./config";
import type { AiGeneratedContentRecord, AiGeneratedImage, PersistedAiGeneration } from "./types";

// AI generation persistence.
// This file is responsible for storing generated content in Supabase:
// 1. optionally upload image bytes into a storage bucket
// 2. write generation metadata into a PostgREST table

// Chooses the strongest available write credential for Supabase operations.
function getSupabaseWriteAuthHeader(serviceRoleKey: string, anonKey: string, accessToken?: string): string {
  return `Bearer ${accessToken || serviceRoleKey || anonKey}`;
}

// Encodes one table, bucket, or object-path segment safely for URLs.
function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

// Builds the PostgREST table endpoint from base URL + table name.
function buildRestTableUrl(baseUrl: string, tableName: string): string {
  return `${baseUrl}/rest/v1/${encodePathSegment(tableName)}`;
}

// Builds the private storage upload URL for a bucket/object path pair.
function buildStorageObjectUrl(baseUrl: string, bucketName: string, objectPath: string): string {
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
  return `${baseUrl}/storage/v1/object/${encodePathSegment(bucketName)}/${encodedPath}`;
}

// Builds the public URL for an uploaded object when the configured bucket is public.
function buildPublicStorageUrl(baseUrl: string, bucketName: string, objectPath: string): string {
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/${encodePathSegment(bucketName)}/${encodedPath}`;
}

// Simple content-type to extension mapper for Supabase object names.
function inferExtension(contentType: string): string {
  if (contentType.includes("png")) {
    return "png";
  }

  if (contentType.includes("webp")) {
    return "webp";
  }

  if (contentType.includes("svg")) {
    return "svg";
  }

  return "jpg";
}

// Converts a base64 string into a binary buffer that can be uploaded to storage.
function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);

  for (let index = 0; index < binary.length; index += 1) {
    view[index] = binary.charCodeAt(index);
  }

  return buffer;
}

// If a generated image is already a `data:image/...;base64,...` URL, this extracts its bytes.
function parseDataUrl(value: string): { contentType: string; buffer: ArrayBuffer } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const contentType = match[1] ?? "image/png";
  const base64 = match[2] ?? "";
  return {
    contentType,
    buffer: decodeBase64ToArrayBuffer(base64)
  };
}

// Returns raw image bytes no matter whether the image came back as a data URL or a hosted URL.
async function downloadImagePayload(imageUrl: string): Promise<{ contentType: string; buffer: ArrayBuffer }> {
  const dataUrl = parseDataUrl(imageUrl);
  if (dataUrl) {
    return dataUrl;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download generated image for Supabase upload: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return {
    contentType,
    buffer
  };
}

// Uploads one generated image to the configured Supabase bucket and returns storage metadata.
async function uploadGeneratedImage(
  image: AiGeneratedImage,
  input: {
    baseUrl: string;
    apiKey: string;
    authHeader: string;
    bucketName: string;
    provider: string;
    prompt: string;
    userId: string | null;
    index: number;
  }
): Promise<{ path: string; publicUrl?: string }> {
  const file = await downloadImagePayload(image.url);
  const promptHash = hashString(`${input.provider}:${input.prompt}:${input.index}`);
  const extension = inferExtension(file.contentType);
  const date = new Date().toISOString().slice(0, 10);
  const objectPath = [
    input.provider,
    input.userId ?? "anonymous",
    date,
    `${promptHash}.${extension}`
  ].join("/");

  const response = await fetch(buildStorageObjectUrl(input.baseUrl, input.bucketName, objectPath), {
    method: "POST",
    headers: {
      apikey: input.apiKey,
      Authorization: input.authHeader,
      "Content-Type": file.contentType,
      "x-upsert": "true"
    },
    body: new Blob([file.buffer], {
      type: file.contentType
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase image upload failed with HTTP ${response.status}${text ? ` :: ${text}` : ""}`);
  }

  return {
    path: objectPath,
    ...(AI_STORAGE_SETTINGS.bucketIsPublic
      ? {
          publicUrl: buildPublicStorageUrl(input.baseUrl, input.bucketName, objectPath)
        }
      : {})
  };
}

// Expands the generated image list with Supabase storage paths/URLs when bucket upload is enabled.
async function enrichImagesForPersistence(
  record: AiGeneratedContentRecord,
  input: {
    baseUrl: string;
    apiKey: string;
    authHeader: string;
    userId: string | null;
  }
): Promise<Array<Record<string, unknown>>> {
  const bucketName = AI_STORAGE_SETTINGS.bucketName.trim();

  if (!bucketName) {
    return record.response.images.map((image) => ({ ...image }));
  }

  return Promise.all(
    record.response.images.map(async (image, index) => {
      const upload = await uploadGeneratedImage(image, {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        authHeader: input.authHeader,
        bucketName,
        provider: record.provider,
        prompt: record.prompt,
        userId: input.userId,
        index
      });

      return {
        ...image,
        supabaseStoragePath: upload.path,
        ...(upload.publicUrl ? { supabaseStorageUrl: upload.publicUrl } : {})
      };
    })
  );
}

// Main persistence entry point called by the wrapper after a successful generation.
// This writes both metadata and, when configured, uploaded image assets.
export async function persistAiGeneration(record: AiGeneratedContentRecord): Promise<PersistedAiGeneration> {
  if (!AI_STORAGE_SETTINGS.enabled) {
    return {
      id: null,
      persisted: false
    };
  }

  const config = getSupabaseAuthConfig();
  const session = await getAuthenticatedSession({
    refreshIfExpired: true
  });
  const apiKey = AI_STORAGE_SETTINGS.serviceRoleKey.trim() || config.anonKey;
  const authHeader = getSupabaseWriteAuthHeader(
    AI_STORAGE_SETTINGS.serviceRoleKey.trim(),
    config.anonKey,
    session?.accessToken
  );
  const userId = record.userId ?? session?.user.id ?? null;
  const persistedImages = await enrichImagesForPersistence(record, {
    baseUrl: config.url,
    apiKey,
    authHeader,
    userId
  });

  const body = {
    provider: record.provider,
    model: record.model,
    prompt: record.prompt,
    category: record.category,
    user_id: userId,
    request_payload: record.request,
    response_payload: {
      ...record.response,
      images: AI_STORAGE_SETTINGS.persistDataUrls
        ? persistedImages
        : persistedImages.map((image) => ({
            ...image,
            url: typeof image.url === "string" && image.url.startsWith("data:image/") ? "" : image.url
          }))
    }
  };

  const response = await fetch(buildRestTableUrl(config.url, AI_STORAGE_SETTINGS.tableName), {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: authHeader,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase AI generation persistence failed with HTTP ${response.status}${text ? ` :: ${text}` : ""}`);
  }

  const rows = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;
  const persistedId = rows[0]?.id;

  return {
    id: typeof persistedId === "string" ? persistedId : null,
    persisted: true
  };
}
