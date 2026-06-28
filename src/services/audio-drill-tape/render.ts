import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { FiloDocument, annotateAudio, type FiloDocumentJson } from "filo";
import type { Database } from "../../lib/db/index.ts";
import type { AudioProvider } from "../ai/audio/index.ts";
import {
  audioAssetId,
  findAudioAssetForRequest,
  storeAudioAsset,
  type CachedAudioAsset,
  type Source,
} from "../corpus/audio-assets.ts";
import type {
  AudioNormalizationSettings,
  LessonSegmentAnnotation,
  LessonSegmentPayload,
  LessonTapeMetadata,
  RenderedAudioPayload,
} from "./types.ts";

export interface RenderLessonAudioOptions {
  sourceAudioPath: string;
  outputDir: string;
  outputFileName?: string;
  audioProvider: AudioProvider;
  db: Database;
  ffmpegPath?: string;
  normalizeAudio?: boolean;
  targetLufs?: number;
  truePeakDb?: number;
  loudnessRange?: number;
  shortClipThresholdMs?: number;
  sourceClipPaddingMs?: number;
}

export interface RenderLessonAudioResult {
  lesson: FiloDocumentJson<LessonTapeMetadata>;
  outputPath: string;
  clipPaths: string[];
}

interface SourceClipRange {
  clipStartMs: number;
  clipEndMs: number;
  sourceClipPaddingMs: number;
}

const DEFAULT_NORMALIZATION: AudioNormalizationSettings = {
  enabled: true,
  targetLufs: -18,
  truePeakDb: -1.5,
  loudnessRange: 11,
  shortClipThresholdMs: 500,
};
const DEFAULT_SOURCE_CLIP_PADDING_MS = 80;

export async function renderLessonAudio(
  lessonJson: FiloDocumentJson<LessonTapeMetadata>,
  options: RenderLessonAudioOptions,
): Promise<RenderLessonAudioResult> {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const normalization = normalizationSettings(options);
  const sourceClipPaddingMs = options.sourceClipPaddingMs ?? DEFAULT_SOURCE_CLIP_PADDING_MS;
  const outputDir = resolve(options.outputDir);
  const clipsDir = join(outputDir, "clips");
  const validatedAudioIds = new Map<string, boolean>();
  await mkdir(clipsDir, { recursive: true });

  const document = FiloDocument.fromJSON<LessonTapeMetadata>(lessonJson);
  const segments = document
    .requireTier<LessonSegmentPayload>("lesson.segment")
    .annotations.sort((left, right) => left.payload.order - right.payload.order);
  const clipPaths: string[] = [];

  for (const segment of segments) {
    const rendered = await renderSegmentClip(document, segment, clipsDir, {
      sourceAudioPath: options.sourceAudioPath,
      audioProvider: options.audioProvider,
      db: options.db,
      ffmpeg,
      normalization,
      sourceClipPaddingMs,
      validatedAudioIds,
    });
    const clipPath = rendered.clipPath;
    clipPaths.push(clipPath);
    addRenderedAudioAnnotation(document, segment, rendered);
  }

  const outputPath = join(
    outputDir,
    options.outputFileName ??
      `${stripExtension(basename(options.sourceAudioPath))}.audio-drill.mp3`,
  );
  const concatListPath = join(clipsDir, "concat.txt");
  await writeFile(
    concatListPath,
    clipPaths.map((path) => `file '${escapeConcatPath(path)}'`).join("\n"),
  );
  await runCommand(ffmpeg, [
    "-y",
    "-xerror",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "128k",
    outputPath,
  ]);

  return {
    lesson: document.toJSON(),
    outputPath,
    clipPaths,
  };
}

async function renderSegmentClip(
  document: FiloDocument<LessonTapeMetadata>,
  segment: LessonSegmentAnnotation,
  clipsDir: string,
  options: {
    sourceAudioPath: string;
    audioProvider: AudioProvider;
    db: Database;
    ffmpeg: string;
    normalization: AudioNormalizationSettings;
    sourceClipPaddingMs: number;
    validatedAudioIds: Map<string, boolean>;
  },
): Promise<{ asset: CachedAudioAsset; clipPath: string }> {
  const text = document.textOf(segment);
  const segmentNormalization = normalizationForPayload(segment, options.normalization);
  const sourceClipRange = sourceClipRangeForSegment(segment, options.sourceClipPaddingMs);
  const source = sourceForSegment(
    document,
    segment,
    options.sourceAudioPath,
    segmentNormalization,
    sourceClipRange,
  );
  const provider = providerForSegment(segment, options.audioProvider.name);
  const request = {
    provider,
    language: segment.payload.language,
    text,
    source,
  };
  const audioId = audioAssetId(request);
  const clipPath = join(clipsDir, `${audioId}.mp3`);
  const cached = await findAudioAssetForRequest(options.db, request);
  if (cached && (await writeCachedClipIfDecodable(cached, clipPath, options))) {
    return { asset: cached, clipPath };
  }
  const reusable = segmentNormalization
    ? await findAudioAssetForRequest(options.db, {
        ...request,
        source: sourceForSegment(document, segment, options.sourceAudioPath, null, sourceClipRange),
      })
    : null;
  if (
    segmentNormalization &&
    reusable &&
    (await writeCachedClipIfDecodable(reusable, clipPath, options))
  ) {
    await normalizeAudioFile(
      options.ffmpeg,
      clipPath,
      segmentNormalization,
      segmentAudioDurationMs(segment, sourceClipRange),
    );
    await assertAudioFileDecodable(options.ffmpeg, clipPath);
    const audio = new Uint8Array(await readFile(clipPath));
    const asset = await storeAudioAsset(options.db, {
      ...request,
      audio,
      contentType: reusable.contentType,
      filoDoc: buildClipFiloDoc(
        text,
        segment,
        reusable.contentType,
        source,
        audioId,
        segmentNormalization,
      ),
    });
    return { asset, clipPath };
  }

  switch (segment.payload.audioSource) {
    case "tts": {
      if (!options.audioProvider.isAvailable()) {
        throw new Error(`Audio provider ${options.audioProvider.name} is not available`);
      }
      const result = await options.audioProvider.synthesize(text, {
        language: segment.payload.language,
      });
      await writeFile(clipPath, result.audio);
      if (segmentNormalization) {
        await normalizeAudioFile(options.ffmpeg, clipPath, segmentNormalization);
      }
      await assertAudioFileDecodable(options.ffmpeg, clipPath);
      const audio = new Uint8Array(await readFile(clipPath));
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio,
        contentType: result.contentType,
        filoDoc: buildClipFiloDoc(
          text,
          segment,
          result.contentType,
          source,
          audioId,
          segmentNormalization,
        ),
      });
      return { asset, clipPath };
    }
    case "source": {
      const startMs = segment.payload.sourceStartMs;
      const endMs = segment.payload.sourceEndMs;
      if (startMs === undefined || endMs === undefined || endMs <= startMs || !sourceClipRange) {
        throw new Error(`Segment ${segment.payload.segmentId} has no valid source timing`);
      }
      await runCommand(options.ffmpeg, [
        "-y",
        "-i",
        options.sourceAudioPath,
        "-ss",
        msToSeconds(sourceClipRange.clipStartMs),
        "-t",
        msToSeconds(sourceClipRange.clipEndMs - sourceClipRange.clipStartMs),
        "-vn",
        ...audioFilterArgs(
          options.normalization,
          sourceClipRange.clipEndMs - sourceClipRange.clipStartMs,
        ),
        "-acodec",
        "libmp3lame",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        clipPath,
      ]);
      await assertAudioFileDecodable(options.ffmpeg, clipPath);
      const audio = new Uint8Array(await readFile(clipPath));
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio,
        contentType: "audio/mpeg",
        filoDoc: buildClipFiloDoc(
          text,
          segment,
          "audio/mpeg",
          source,
          audioId,
          segmentNormalization,
        ),
      });
      return { asset, clipPath };
    }
    case "silence": {
      const durationMs = segment.payload.durationMs ?? 3000;
      await runCommand(options.ffmpeg, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        msToSeconds(durationMs),
        "-acodec",
        "libmp3lame",
        "-b:a",
        "128k",
        clipPath,
      ]);
      await assertAudioFileDecodable(options.ffmpeg, clipPath);
      const audio = new Uint8Array(await readFile(clipPath));
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio,
        contentType: "audio/mpeg",
        filoDoc: buildClipFiloDoc(text, segment, "audio/mpeg", source, audioId, null),
      });
      return { asset, clipPath };
    }
  }
}

function addRenderedAudioAnnotation(
  document: FiloDocument<LessonTapeMetadata>,
  segment: LessonSegmentAnnotation,
  rendered: { asset: CachedAudioAsset; clipPath: string },
): void {
  const normalization = rendered.asset.source
    ? normalizationFromSource(rendered.asset.source)
    : null;
  const sourceClipRange = rendered.asset.source
    ? sourceClipRangeFromSource(rendered.asset.source)
    : null;
  const payload: RenderedAudioPayload = {
    url: `audio:${rendered.asset.audioId}`,
    mimeType: rendered.asset.contentType,
    segmentId: segment.payload.segmentId,
    order: segment.payload.order,
    language: segment.payload.language,
    audioSource: segment.payload.audioSource,
    clipPath: rendered.clipPath,
    audioId: rendered.asset.audioId,
    provider: rendered.asset.provider,
    source: rendered.asset.source,
    ...(segment.payload.sourceStartMs !== undefined
      ? { sourceStartMs: segment.payload.sourceStartMs }
      : {}),
    ...(segment.payload.sourceEndMs !== undefined
      ? { sourceEndMs: segment.payload.sourceEndMs }
      : {}),
    ...(sourceClipRange ? sourceClipRange : {}),
    ...(segment.payload.durationMs !== undefined ? { durationMs: segment.payload.durationMs } : {}),
    ...(normalization ? { normalization } : {}),
    generatedAt: new Date().toISOString(),
  };
  annotateAudio(document, {
    start: segment.start,
    end: segment.end,
    tierId: "audio:generated",
    url: `audio:${rendered.asset.audioId}`,
    mimeType: rendered.asset.contentType,
    source: "langouste.audio-drill.render",
    payload,
  });
}

function providerForSegment(segment: LessonSegmentAnnotation, ttsProvider: string): string {
  switch (segment.payload.audioSource) {
    case "tts":
      return ttsProvider;
    case "source":
      return "source-clip";
    case "silence":
      return "silence";
  }
}

function sourceForSegment(
  document: FiloDocument<LessonTapeMetadata>,
  segment: LessonSegmentAnnotation,
  sourceAudioPath: string,
  normalization: AudioNormalizationSettings | null,
  sourceClipRange: SourceClipRange | null,
): Source {
  const metadata = document.metadata;
  switch (segment.payload.audioSource) {
    case "tts":
      return {
        type: "tts",
        label: `${languageNameForSource(segment.payload.language)} for "${document.textOf(segment)}"`,
        language: segment.payload.language,
        text: document.textOf(segment),
        ...(normalization ? { normalization } : {}),
      };
    case "source":
      return {
        type: "source-audio",
        label: `${languageNameForSource(segment.payload.language)} from source "${document.textOf(segment)}"`,
        language: segment.payload.language,
        text: document.textOf(segment),
        uri: metadata.sourceUrl ?? metadata.sourceAudioPath ?? sourceAudioPath,
        sourceUrl: metadata.sourceUrl,
        sourceAudioPath: metadata.sourceAudioPath ?? sourceAudioPath,
        sourceDocumentId: metadata.sourceDocumentId,
        sourceTierId: segment.payload.sourceTierId,
        sourceAnnotationId: segment.payload.sourceAnnotationId,
        sourceStartMs: segment.payload.sourceStartMs,
        sourceEndMs: segment.payload.sourceEndMs,
        startMs: segment.payload.sourceStartMs,
        endMs: segment.payload.sourceEndMs,
        ...(sourceClipRange ? sourceClipRange : {}),
        ...(normalization ? { normalization } : {}),
      };
    case "silence":
      return {
        type: "silence",
        label: `silence ${segment.payload.durationMs ?? 3000}ms`,
        language: "zxx",
        text: document.textOf(segment),
        durationMs: segment.payload.durationMs ?? 3000,
      };
  }
}

function buildClipFiloDoc(
  text: string,
  segment: LessonSegmentAnnotation,
  mimeType: string,
  source: Source,
  audioId: string,
  normalization: AudioNormalizationSettings | null,
): FiloDocumentJson {
  const clip = FiloDocument.fromText(text, {
    id: `audio-clip:${audioId}`,
    metadata: {
      corpus: "audio-assets",
      audioId,
      language: segment.payload.language,
      source,
      ...(normalization ? { normalization } : {}),
      createdAt: new Date().toISOString(),
    },
  });
  clip.ensureTier<LessonSegmentPayload>({
    id: "clip.segment",
    kind: "custom",
    description: "Generated audio clip segment",
    source: "langouste.audio-cache",
  });
  clip.ensureTier<{ language: string; source: Source }>({
    id: "language",
    kind: "language",
    description: "Clip language",
    source: "langouste.audio-cache",
  });
  const range = { start: 0, end: clip.byteLength };
  clip.addAnnotation("clip.segment", {
    ...range,
    payload: segment.payload,
    source: "langouste.audio-cache",
  });
  clip.addAnnotation("language", {
    ...range,
    payload: {
      language: segment.payload.language,
      source,
    },
    source: "langouste.audio-cache",
  });
  annotateAudio(clip, {
    ...range,
    tierId: "audio",
    url: `audio:${audioId}`,
    mimeType,
    source: "langouste.audio-cache",
    payload: {
      audioId,
      source,
      ...(normalization ? { normalization } : {}),
    },
  });
  return clip.toJSON();
}

function normalizationSettings(options: RenderLessonAudioOptions): AudioNormalizationSettings {
  return {
    enabled: options.normalizeAudio ?? DEFAULT_NORMALIZATION.enabled,
    targetLufs: options.targetLufs ?? DEFAULT_NORMALIZATION.targetLufs,
    truePeakDb: options.truePeakDb ?? DEFAULT_NORMALIZATION.truePeakDb,
    loudnessRange: options.loudnessRange ?? DEFAULT_NORMALIZATION.loudnessRange,
    shortClipThresholdMs:
      options.shortClipThresholdMs ?? DEFAULT_NORMALIZATION.shortClipThresholdMs,
  };
}

function normalizationForPayload(
  segment: LessonSegmentAnnotation,
  normalization: AudioNormalizationSettings,
): AudioNormalizationSettings | null {
  if (!normalization.enabled || segment.payload.audioSource === "silence") return null;
  return normalization;
}

function normalizationFromSource(source: Source): AudioNormalizationSettings | null {
  const candidate = source.normalization;
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<AudioNormalizationSettings>;
  if (value.enabled !== true) return null;
  if (
    typeof value.targetLufs !== "number" ||
    typeof value.truePeakDb !== "number" ||
    typeof value.loudnessRange !== "number"
  ) {
    return null;
  }
  return {
    enabled: true,
    targetLufs: value.targetLufs,
    truePeakDb: value.truePeakDb,
    loudnessRange: value.loudnessRange,
    shortClipThresholdMs:
      typeof value.shortClipThresholdMs === "number"
        ? value.shortClipThresholdMs
        : DEFAULT_NORMALIZATION.shortClipThresholdMs,
  };
}

async function normalizeAudioFile(
  ffmpeg: string,
  path: string,
  normalization: AudioNormalizationSettings,
  durationMs?: number,
): Promise<void> {
  const normalizedPath = `${path}.normalized.mp3`;
  await runCommand(ffmpeg, [
    "-y",
    "-i",
    path,
    "-vn",
    ...audioFilterArgs(normalization, durationMs),
    "-acodec",
    "libmp3lame",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "128k",
    normalizedPath,
  ]);
  await rename(normalizedPath, path);
}

function audioFilterArgs(normalization: AudioNormalizationSettings, durationMs?: number): string[] {
  if (!normalization.enabled) return [];
  return ["-af", audioFilterExpression(normalization, durationMs)];
}

function audioFilterExpression(
  normalization: AudioNormalizationSettings,
  durationMs?: number,
): string {
  if (durationMs !== undefined && durationMs < normalization.shortClipThresholdMs) {
    return "dynaudnorm=f=50:g=15,alimiter=limit=0.95";
  }
  return [
    `loudnorm=I=${normalization.targetLufs}:TP=${normalization.truePeakDb}:LRA=${normalization.loudnessRange}`,
    "alimiter=limit=0.95",
  ].join(",");
}

function segmentAudioDurationMs(
  segment: LessonSegmentAnnotation,
  sourceClipRange?: SourceClipRange | null,
): number | undefined {
  if (sourceClipRange) return sourceClipRange.clipEndMs - sourceClipRange.clipStartMs;
  if (
    segment.payload.sourceStartMs !== undefined &&
    segment.payload.sourceEndMs !== undefined &&
    segment.payload.sourceEndMs > segment.payload.sourceStartMs
  ) {
    return segment.payload.sourceEndMs - segment.payload.sourceStartMs;
  }
  return segment.payload.durationMs;
}

function sourceClipRangeForSegment(
  segment: LessonSegmentAnnotation,
  sourceClipPaddingMs: number,
): SourceClipRange | null {
  if (segment.payload.audioSource !== "source") return null;
  const startMs = segment.payload.sourceStartMs;
  const endMs = segment.payload.sourceEndMs;
  if (startMs === undefined || endMs === undefined || endMs <= startMs) return null;
  const paddingMs = Math.max(0, sourceClipPaddingMs);
  return {
    clipStartMs: Math.max(0, startMs - paddingMs),
    clipEndMs: endMs + paddingMs,
    sourceClipPaddingMs: paddingMs,
  };
}

function sourceClipRangeFromSource(source: Source): SourceClipRange | null {
  const { clipStartMs, clipEndMs, sourceClipPaddingMs } = source;
  if (
    typeof clipStartMs !== "number" ||
    typeof clipEndMs !== "number" ||
    typeof sourceClipPaddingMs !== "number"
  ) {
    return null;
  }
  return { clipStartMs, clipEndMs, sourceClipPaddingMs };
}

async function writeCachedClipIfDecodable(
  cached: CachedAudioAsset,
  clipPath: string,
  options: {
    ffmpeg: string;
    validatedAudioIds: Map<string, boolean>;
  },
): Promise<boolean> {
  const known = options.validatedAudioIds.get(cached.audioId);
  if (known === false) return false;
  await writeFile(clipPath, cached.audio);
  if (known === true) return true;
  const decodable = await canDecodeAudioFile(options.ffmpeg, clipPath);
  options.validatedAudioIds.set(cached.audioId, decodable);
  return decodable;
}

async function assertAudioFileDecodable(ffmpeg: string, path: string): Promise<void> {
  if (await canDecodeAudioFile(ffmpeg, path)) return;
  throw new Error(`Rendered audio clip is not decodable: ${path}`);
}

async function canDecodeAudioFile(ffmpeg: string, path: string): Promise<boolean> {
  try {
    await runCommand(ffmpeg, ["-v", "error", "-i", path, "-f", "null", "-"]);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${exitCode}\n${stdout}\n${stderr}`.trim(),
    );
  }
}

function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function escapeConcatPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function languageNameForSource(language: string): string {
  const names: Record<string, string> = {
    en: "English",
    hu: "Hungarian",
    fr: "French",
    es: "Spanish",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    tr: "Turkish",
    nl: "Dutch",
    pl: "Polish",
    ru: "Russian",
    zxx: "silence",
  };
  return names[language] ?? language.toLocaleUpperCase();
}
