import { adminDb, type Database } from "../../../lib/db/index.ts";
import {
  findAudioAssetForRequest,
  storeAudioAsset,
  type CachedAudioAsset,
} from "../../corpus/audio-assets.ts";
import { getAudioProvider } from "./index.ts";
import type { AudioProvider } from "./provider.ts";

export interface CachedAudioSynthesisInput {
  text: string;
  language?: string;
  userId?: string;
}

export interface CachedAudioSynthesisDependencies {
  provider?: AudioProvider;
  db?: Database;
}

/**
 * The single TTS orchestration path used by every Langouste surface and by
 * sibling applications through the package's `langouste/audio` export.
 * Identical provider/language/text requests share the same deterministic
 * audio_assets row in turbopuffer.
 */
export async function synthesizeCachedAudio(
  input: CachedAudioSynthesisInput,
  dependencies: CachedAudioSynthesisDependencies = {},
): Promise<CachedAudioAsset> {
  const text = input.text.trim();
  if (!text) throw new Error("text is required");
  if (text.length > 1000) throw new Error("text is too long for audio");

  const provider = dependencies.provider ?? getAudioProvider();
  if (!provider.isAvailable()) throw new Error("Audio provider not configured");
  const db = dependencies.db ?? adminDb();
  const language = input.language?.trim() || undefined;
  const cached = await findAudioAssetForRequest(db, {
    provider: provider.name,
    language: language ?? null,
    text,
  }).catch(() => null);
  if (cached) return cached;

  const result = await provider.synthesize(text, { language, userId: input.userId });
  return storeAudioAsset(db, {
    provider: provider.name,
    language: language ?? null,
    text,
    audio: result.audio,
    contentType: result.contentType,
  });
}

export function audioProviderAvailable(): boolean {
  return getAudioProvider().isAvailable();
}

export function audioAssetResponse(asset: CachedAudioAsset): Response {
  const audioBody = new ArrayBuffer(asset.audio.byteLength);
  new Uint8Array(audioBody).set(asset.audio);
  return new Response(audioBody, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(asset.audio.byteLength),
      "X-Langouste-Audio-Id": asset.audioId,
    },
  });
}

export type { CachedAudioAsset } from "../../corpus/audio-assets.ts";
