import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { annotateAudio } from "../../../filo/src/annotators/audio";
import { FiloDocument } from "../../../filo/src/document";
import type { FiloDocumentJson } from "../../../filo/src/types";
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
}

export interface RenderLessonAudioResult {
  lesson: FiloDocumentJson<LessonTapeMetadata>;
  outputPath: string;
  clipPaths: string[];
}

export async function renderLessonAudio(
  lessonJson: FiloDocumentJson<LessonTapeMetadata>,
  options: RenderLessonAudioOptions,
): Promise<RenderLessonAudioResult> {
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const outputDir = resolve(options.outputDir);
  const clipsDir = join(outputDir, "clips");
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
    });
    const clipPath = rendered.clipPath;
    clipPaths.push(clipPath);
    addRenderedAudioAnnotation(document, segment, rendered);
  }

  const outputPath = join(
    outputDir,
    options.outputFileName ?? `${stripExtension(basename(options.sourceAudioPath))}.pimsleur.mp3`,
  );
  const concatListPath = join(clipsDir, "concat.txt");
  await writeFile(
    concatListPath,
    clipPaths.map((path) => `file '${escapeConcatPath(path)}'`).join("\n"),
  );
  await runCommand(ffmpeg, [
    "-y",
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
  },
): Promise<{ asset: CachedAudioAsset; clipPath: string }> {
  const text = document.textOf(segment);
  const source = sourceForSegment(document, segment, options.sourceAudioPath);
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
  if (cached) {
    await writeFile(clipPath, cached.audio);
    return { asset: cached, clipPath };
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
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio: result.audio,
        contentType: result.contentType,
        filoDoc: buildClipFiloDoc(text, segment, result.contentType, source, audioId),
      });
      return { asset, clipPath };
    }
    case "source": {
      const startMs = segment.payload.sourceStartMs;
      const endMs = segment.payload.sourceEndMs;
      if (startMs === undefined || endMs === undefined || endMs <= startMs) {
        throw new Error(`Segment ${segment.payload.segmentId} has no valid source timing`);
      }
      await runCommand(options.ffmpeg, [
        "-y",
        "-i",
        options.sourceAudioPath,
        "-ss",
        msToSeconds(startMs),
        "-t",
        msToSeconds(endMs - startMs),
        "-vn",
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
      const audio = new Uint8Array(await readFile(clipPath));
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio,
        contentType: "audio/mpeg",
        filoDoc: buildClipFiloDoc(text, segment, "audio/mpeg", source, audioId),
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
      const audio = new Uint8Array(await readFile(clipPath));
      const asset = await storeAudioAsset(options.db, {
        ...request,
        audio,
        contentType: "audio/mpeg",
        filoDoc: buildClipFiloDoc(text, segment, "audio/mpeg", source, audioId),
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
    ...(segment.payload.durationMs !== undefined ? { durationMs: segment.payload.durationMs } : {}),
    generatedAt: new Date().toISOString(),
  };
  annotateAudio(document, {
    start: segment.start,
    end: segment.end,
    tierId: "audio:generated",
    url: `audio:${rendered.asset.audioId}`,
    mimeType: rendered.asset.contentType,
    source: "langouste.pimsleur.render",
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
): Source {
  const metadata = document.metadata;
  switch (segment.payload.audioSource) {
    case "tts":
      return {
        type: "tts",
        label: `${languageNameForSource(segment.payload.language)} for "${document.textOf(segment)}"`,
        language: segment.payload.language,
        text: document.textOf(segment),
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
): FiloDocumentJson {
  const clip = FiloDocument.fromText(text, {
    id: `audio-clip:${audioId}`,
    metadata: {
      corpus: "audio-assets",
      audioId,
      language: segment.payload.language,
      source,
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
    },
  });
  return clip.toJSON();
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
