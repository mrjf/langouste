import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FiloDocumentJson } from "filo";
import type { Database } from "../../lib/db/index.ts";
import {
  audioAssetId,
  findAudioAsset,
  storeIdentifiedAudioAsset,
  type CachedAudioAsset,
  type Source,
} from "./audio-assets.ts";
import { indexFiloDocument } from "./store.ts";

export interface AudioDrillListItem {
  id: string;
  title: string;
  sourceLanguage: string | null;
  bridgeLanguage: string | null;
  segmentCount: number;
  generatedAudioCount: number;
  sourceAudioCount: number;
  lessonUpdatedAt: string | null;
  audioFileName: string | null;
  audioByteLength: number | null;
  audioUpdatedAt: string | null;
}

export interface AudioDrillRecord {
  owner_id: string;
  drill_id: string;
  title: string;
  source_language: string | null;
  bridge_language: string | null;
  segment_count: number;
  generated_audio_count: number;
  source_audio_count: number;
  lesson: FiloDocumentJson;
  source: FiloDocumentJson | null;
  final_audio_id: string | null;
  source_audio_id: string | null;
  clip_audio_ids: string[];
  audio_file_name: string | null;
  audio_byte_length: number | null;
  created_at: string;
  updated_at: string;
}

export async function listStoredAudioDrills(
  db: Database,
  ownerId: string,
): Promise<AudioDrillListItem[]> {
  const rows = await db.select<AudioDrillRecord>("audio_drills", {
    filters: [{ op: "eq", column: "owner_id", value: ownerId }],
    order: [{ column: "updated_at", ascending: false }],
  });
  return rows.map(audioDrillListItem);
}

export async function getStoredAudioDrill(
  db: Database,
  ownerId: string,
  drillId: string,
): Promise<AudioDrillRecord | null> {
  return db.selectOne<AudioDrillRecord>("audio_drills", {
    filters: [
      { op: "eq", column: "owner_id", value: ownerId },
      { op: "eq", column: "drill_id", value: drillId },
    ],
  });
}

/**
 * Import a completed build directory into durable turbopuffer records. The
 * directory remains a disposable render cache; reads are served from storage.
 */
export async function persistAudioDrillDirectory(
  db: Database,
  ownerId: string,
  drillId: string,
  dir: string,
  lesson: FiloDocumentJson,
  source: FiloDocumentJson | null,
): Promise<AudioDrillRecord> {
  const files = await readdir(dir).catch(() => []);
  const finalFileName = files.find((file) => file.endsWith(".audio-drill.mp3")) ?? null;
  const sourceFileName =
    files.find((file) => file.endsWith(".mp3") && !file.endsWith(".audio-drill.mp3")) ?? null;

  const finalAsset = finalFileName
    ? await storeDrillAudioFile(db, {
        ownerId,
        drillId,
        kind: "final",
        path: join(dir, finalFileName),
        fileName: finalFileName,
        language: stringValue(lesson.metadata.sourceLanguage),
      })
    : null;
  const sourceAsset = sourceFileName
    ? await storeDrillAudioFile(db, {
        ownerId,
        drillId,
        kind: "source",
        path: join(dir, sourceFileName),
        fileName: sourceFileName,
        language: source ? documentLanguage(source) : null,
      })
    : null;

  const clipAudioIds: string[] = [];
  const clipFiles = await readdir(join(dir, "clips")).catch(() => []);
  for (const fileName of clipFiles) {
    const match = /^(aud_[a-f0-9]{64})\.mp3$/u.exec(fileName);
    if (!match) continue;
    const audioId = match[1];
    await storeDrillAudioFile(db, {
      ownerId,
      drillId,
      kind: "clip",
      path: join(dir, "clips", fileName),
      fileName,
      language: null,
      audioId,
    });
    clipAudioIds.push(audioId);
  }

  const now = new Date().toISOString();
  const existing = await getStoredAudioDrill(db, ownerId, drillId);
  const row = await db.upsert<AudioDrillRecord>(
    "audio_drills",
    {
      owner_id: ownerId,
      drill_id: drillId,
      title: stringValue(lesson.metadata.title) || drillId,
      source_language: stringValue(lesson.metadata.sourceLanguage),
      bridge_language: stringValue(lesson.metadata.bridgeLanguage),
      segment_count: tierCount(lesson, "lesson.segment"),
      generated_audio_count: tierCount(lesson, "audio:generated"),
      source_audio_count: tierCount(lesson, "audio:source"),
      lesson,
      source,
      final_audio_id: finalAsset?.audioId ?? null,
      source_audio_id: sourceAsset?.audioId ?? null,
      clip_audio_ids: clipAudioIds,
      audio_file_name: finalFileName,
      audio_byte_length: finalAsset?.byteLength ?? null,
      updated_at: now,
      ...(existing ? { created_at: existing.created_at } : {}),
    },
    ["owner_id", "drill_id"],
  );
  await indexAudioDrillDocuments(db, ownerId, drillId, lesson, source);
  return row;
}

export async function updateStoredAudioDrillLesson(
  db: Database,
  ownerId: string,
  drillId: string,
  lesson: FiloDocumentJson,
): Promise<AudioDrillRecord | null> {
  const existing = await getStoredAudioDrill(db, ownerId, drillId);
  if (!existing) return null;
  const updated = await db.updateOne<AudioDrillRecord>(
    "audio_drills",
    {
      title: stringValue(lesson.metadata.title) || drillId,
      source_language: stringValue(lesson.metadata.sourceLanguage),
      bridge_language: stringValue(lesson.metadata.bridgeLanguage),
      segment_count: tierCount(lesson, "lesson.segment"),
      generated_audio_count: tierCount(lesson, "audio:generated"),
      source_audio_count: tierCount(lesson, "audio:source"),
      lesson,
      updated_at: new Date().toISOString(),
    },
    [
      { op: "eq", column: "owner_id", value: ownerId },
      { op: "eq", column: "drill_id", value: drillId },
    ],
  );
  await indexFiloDocument(db, lesson, {
    ownerId,
    sourceType: "audio_drill",
    sourceId: drillId,
    language: documentLanguage(lesson),
    title: stringValue(lesson.metadata.title),
  });
  return updated;
}

export async function findStoredAudioDrillAsset(
  db: Database,
  ownerId: string,
  drillId: string,
  kind: "final" | "source",
): Promise<CachedAudioAsset | null> {
  const drill = await getStoredAudioDrill(db, ownerId, drillId);
  if (!drill) return null;
  return findAudioAsset(db, kind === "final" ? drill.final_audio_id : drill.source_audio_id);
}

export async function findStoredAudioDrillClip(
  db: Database,
  ownerId: string,
  drillId: string,
  audioId: string,
): Promise<CachedAudioAsset | null> {
  const drill = await getStoredAudioDrill(db, ownerId, drillId);
  if (!drill?.clip_audio_ids.includes(audioId)) return null;
  return findAudioAsset(db, audioId);
}

export function audioDrillListItem(row: AudioDrillRecord): AudioDrillListItem {
  return {
    id: row.drill_id,
    title: row.title,
    sourceLanguage: row.source_language,
    bridgeLanguage: row.bridge_language,
    segmentCount: row.segment_count,
    generatedAudioCount: row.generated_audio_count,
    sourceAudioCount: row.source_audio_count,
    lessonUpdatedAt: row.updated_at,
    audioFileName: row.audio_file_name,
    audioByteLength: row.audio_byte_length,
    audioUpdatedAt: row.final_audio_id ? row.updated_at : null,
  };
}

async function indexAudioDrillDocuments(
  db: Database,
  ownerId: string,
  drillId: string,
  lesson: FiloDocumentJson,
  source: FiloDocumentJson | null,
): Promise<void> {
  await indexFiloDocument(db, lesson, {
    ownerId,
    sourceType: "audio_drill",
    sourceId: drillId,
    language: documentLanguage(lesson),
    title: stringValue(lesson.metadata.title),
  });
  if (source) {
    await indexFiloDocument(db, source, {
      ownerId,
      sourceType: "audio_drill",
      sourceId: drillId,
      language: documentLanguage(source),
      title: stringValue(source.metadata.title),
    });
  }
}

async function storeDrillAudioFile(
  db: Database,
  input: {
    ownerId: string;
    drillId: string;
    kind: "final" | "source" | "clip";
    path: string;
    fileName: string;
    language: string | null;
    audioId?: string;
  },
): Promise<CachedAudioAsset | null> {
  const fileStat = await stat(input.path).catch(() => null);
  if (!fileStat?.isFile()) return null;
  const audio = new Uint8Array(await readFile(input.path));
  const source: Source = {
    type: "source-audio",
    label: `audio-drill-${input.kind}`,
    language: input.language,
    uri: `audio-drill:${input.drillId}:${input.fileName}`,
  };
  const audioId =
    input.audioId ??
    audioAssetId({
      provider: "audio-drill",
      language: input.language,
      text: `${input.ownerId}:${input.drillId}:${input.kind}`,
      source,
    });
  return storeIdentifiedAudioAsset(db, {
    audioId,
    provider: "audio-drill",
    language: input.language,
    text: `${input.drillId}:${input.kind}`,
    audio,
    contentType: "audio/mpeg",
    source,
  });
}

function documentLanguage(document: FiloDocumentJson): string | null {
  return (
    stringValue(document.metadata.sourceLanguage) ??
    stringValue(document.metadata.language) ??
    stringValue(document.metadata.targetLanguage)
  );
}

function tierCount(document: FiloDocumentJson, tierId: string): number {
  return document.tiers.find((tier) => tier.id === tierId)?.annotations.length ?? 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
