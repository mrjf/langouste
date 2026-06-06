import { createHash } from "node:crypto";
import type { FiloDocumentJson } from "../../../filo/src/types";
import type { Database } from "../../lib/db/index.ts";

export interface Source {
  [key: string]: unknown;
  type: "tts" | "source-audio" | "silence";
  label: string;
  language?: string | null;
  text?: string;
  uri?: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  sourceDocumentId?: string;
  sourceTierId?: string;
  sourceAnnotationId?: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
}

export interface AudioAsset {
  audio_id: string;
  provider: string;
  language: string | null;
  text_hash: string;
  content_hash: string;
  mime_type: string;
  byte_length: number;
  audio_base64: string;
  source?: Source | null;
  filo_doc?: FiloDocumentJson | null;
  created_at: string;
}

export interface AudioAssetInput {
  provider: string;
  language?: string | null;
  text: string;
  audio: Uint8Array;
  contentType: string;
  source?: Source | null;
  filoDoc?: FiloDocumentJson | null;
}

export interface CachedAudioAsset {
  audioId: string;
  provider: string;
  language: string | null;
  textHash: string;
  contentHash: string;
  contentType: string;
  byteLength: number;
  audio: Uint8Array;
  source: Source | null;
  filoDoc: FiloDocumentJson | null;
}

export function audioAssetId(input: {
  provider: string;
  language?: string | null;
  text: string;
  source?: Source | null;
}): string {
  return `aud_${sha256Hex(requestKey(input))}`;
}

export function audioTextHash(text: string): string {
  return sha256Hex(text);
}

export async function findAudioAsset(
  db: Database,
  audioId: string | null | undefined,
): Promise<CachedAudioAsset | null> {
  if (!audioId) return null;
  const row = await db.selectOne<AudioAsset>("audio_assets", {
    filters: [{ op: "eq", column: "audio_id", value: audioId }],
  });
  return row ? toCachedAudioAsset(row) : null;
}

export async function findAudioAssetForRequest(
  db: Database,
  input: { provider: string; language?: string | null; text: string; source?: Source | null },
): Promise<CachedAudioAsset | null> {
  return findAudioAsset(db, audioAssetId(input));
}

export async function storeAudioAsset(
  db: Database,
  input: AudioAssetInput,
): Promise<CachedAudioAsset> {
  const audioId = audioAssetId(input);
  const row = await db.upsert<AudioAsset>(
    "audio_assets",
    {
      audio_id: audioId,
      provider: input.provider,
      language: input.language ?? null,
      text_hash: audioTextHash(input.text),
      content_hash: sha256Bytes(input.audio),
      mime_type: input.contentType,
      byte_length: input.audio.byteLength,
      audio_base64: Buffer.from(input.audio).toString("base64"),
      source: input.source ?? null,
      filo_doc: input.filoDoc ?? null,
    },
    ["audio_id"],
  );
  return toCachedAudioAsset(row);
}

function toCachedAudioAsset(row: AudioAsset): CachedAudioAsset {
  const audio = new Uint8Array(Buffer.from(row.audio_base64, "base64"));
  return {
    audioId: row.audio_id,
    provider: row.provider,
    language: row.language,
    textHash: row.text_hash,
    contentHash: row.content_hash,
    contentType: row.mime_type,
    byteLength: row.byte_length,
    audio,
    source: row.source ?? null,
    filoDoc: row.filo_doc ?? null,
  };
}

function requestKey(input: {
  provider: string;
  language?: string | null;
  text: string;
  source?: Source | null;
}): string {
  return [
    "v2",
    input.provider,
    input.language ?? "und",
    input.text,
    stableJson(input.source ?? null),
  ].join("\0");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
}
