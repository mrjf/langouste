import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { copyFile, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { dataPath } from "../../lib/data-dir.ts";
import { adminDb } from "../../lib/db/index.ts";
import type { AudioProvider } from "../ai/audio/index.ts";
import { getAudioProvider } from "../ai/audio/index.ts";
import type { TranslationProvider } from "../ai/translation/index.ts";
import { getTranslationProvider } from "../ai/translation/index.ts";
import type { TimedTranscript, TranscriptionProvider } from "../ai/transcription/index.ts";
import { getTranscriptionProvider } from "../ai/transcription/index.ts";
import { buildLessonTapeFilo } from "./lesson-filo.ts";
import { auditRenderedLessonTape } from "./quality.ts";
import { renderLessonAudio } from "./render.ts";
import { annotateTrainingSentences, buildSourceTranscriptFilo } from "./source-filo.ts";
import {
  ClaudeSourceSentenceExtractor,
  type SourceSentenceExtractor,
} from "./sentence-extractor.ts";
import type { AudioDrillTapeDocuments, LessonPlanOverride } from "./types.ts";

export interface BuildAudioDrillTapeInput {
  sourceUrl: string;
  outputDir: string;
  sourceLanguage: string;
  bridgeLanguage?: string;
  title?: string;
  transcriptPath?: string;
  renderAudio?: boolean;
  maxItems?: number;
  pauseMs?: number;
  wordPauseMs?: number;
  reviewIntervalsMs?: number[];
  reviewOffsets?: number[];
  lessonPlan?: LessonPlanOverride;
  phraseMaxWords?: number;
  phrasePauseMs?: number;
  normalizeAudio?: boolean;
  targetLufs?: number;
  truePeakDb?: number;
  loudnessRange?: number;
  shortClipThresholdMs?: number;
  sourceClipPaddingMs?: number;
  trimTtsSilence?: boolean;
  cueOverrides?: Record<string, string>;
  targetTextOverrides?: Record<string, string>;
  transcriptionProvider?: TranscriptionProvider;
  translationProvider?: TranslationProvider;
  audioProvider?: AudioProvider;
  sentenceExtractor?: SourceSentenceExtractor;
}

export interface BuildAudioDrillTapeResult {
  documents: AudioDrillTapeDocuments;
  sourceAudioPath: string;
  transcriptPath: string;
  sourceFiloPath: string;
  lessonFiloPath: string;
  qualityReportPath: string;
  outputAudioPath?: string;
}

export async function buildAudioDrillTape(
  input: BuildAudioDrillTapeInput,
): Promise<BuildAudioDrillTapeResult> {
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });

  const bridgeLanguage = input.bridgeLanguage ?? "en";
  const title = input.title ?? titleFromUrl(input.sourceUrl);
  const sourceAudioPath = join(outputDir, fileNameFromUrl(input.sourceUrl));
  await downloadAudioFile(input.sourceUrl, sourceAudioPath);

  const transcriptionProvider = input.transcriptionProvider ?? getTranscriptionProvider();
  const translationProvider = input.translationProvider ?? getTranslationProvider();
  const transcript = input.transcriptPath
    ? await readTranscript(input.transcriptPath)
    : await transcriptionProvider.transcribe({
        audioPath: sourceAudioPath,
        sourceUrl: input.sourceUrl,
        language: input.sourceLanguage,
      });

  const transcriptPath = join(outputDir, "transcript.json");
  await writeJson(transcriptPath, transcript);

  const sourceBase = buildSourceTranscriptFilo(transcript, {
    title,
    sourceLanguage: input.sourceLanguage,
    sourceUrl: input.sourceUrl,
    sourceAudioPath,
    phraseMaxWords: input.phraseMaxWords,
    phrasePauseMs: input.phrasePauseMs,
  });
  const sentenceExtractor = input.sentenceExtractor ?? new ClaudeSourceSentenceExtractor();
  const extractedSentences = await sentenceExtractor.extractSentences({
    source: sourceBase,
    sourceLanguage: input.sourceLanguage,
    bridgeLanguage,
    maxCandidates: Math.max(72, (input.maxItems ?? 12) * 12),
  });
  // The extractor supplies contextual sentence translations. Translating every raw word and
  // pause-derived phrase first produced expensive, context-free glosses (and made those glosses
  // tempting lesson material), so the production pipeline intentionally enriches only reviewed
  // training sentences.
  const source = annotateTrainingSentences(sourceBase, extractedSentences, bridgeLanguage);
  const sourceFiloPath = join(outputDir, "source.filo.json");
  await writeJson(sourceFiloPath, source);

  let lesson = await buildLessonTapeFilo(source, translationProvider, {
    title,
    sourceLanguage: input.sourceLanguage,
    bridgeLanguage,
    sourceUrl: input.sourceUrl,
    sourceAudioPath,
    maxItems: input.maxItems,
    pauseMs: input.pauseMs,
    wordPauseMs: input.wordPauseMs,
    reviewIntervalsMs: input.reviewIntervalsMs,
    reviewOffsets: input.reviewOffsets,
    lessonPlan: input.lessonPlan,
    cueOverrides: input.cueOverrides,
    targetTextOverrides: input.targetTextOverrides,
  });

  let outputAudioPath: string | undefined;
  if (input.renderAudio) {
    const rendered = await renderLessonAudio(lesson, {
      sourceAudioPath,
      outputDir,
      audioProvider: input.audioProvider ?? getAudioProvider(),
      db: adminDb(),
      normalizeAudio: input.normalizeAudio,
      targetLufs: input.targetLufs,
      truePeakDb: input.truePeakDb,
      loudnessRange: input.loudnessRange,
      shortClipThresholdMs: input.shortClipThresholdMs,
      sourceClipPaddingMs: input.sourceClipPaddingMs,
      trimTtsSilence: input.trimTtsSilence,
    });
    lesson = rendered.lesson;
    outputAudioPath = rendered.outputPath;
  }

  const lessonFiloPath = join(outputDir, "lesson.filo.json");
  await writeJson(lessonFiloPath, lesson);
  const qualityReportPath = join(outputDir, "quality-report.json");
  const qualityReport = await auditRenderedLessonTape(lesson, outputAudioPath);
  await writeJson(qualityReportPath, qualityReport);
  if (!qualityReport.passed) {
    throw new Error(
      `Audio drill quality gate failed; see ${qualityReportPath}: ${qualityReport.issues.join(" ")}`,
    );
  }

  return {
    documents: { source, lesson },
    sourceAudioPath,
    transcriptPath,
    sourceFiloPath,
    lessonFiloPath,
    qualityReportPath,
    ...(outputAudioPath ? { outputAudioPath } : {}),
  };
}

export async function downloadAudioFile(url: string, outputPath: string): Promise<void> {
  const resolvedOutputPath = resolve(outputPath);
  if (await hasUsableFile(resolvedOutputPath)) {
    await seedDownloadCache(url, resolvedOutputPath);
    return;
  }

  const cached = await cachedDownloadPath(url);
  if (cached) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    await copyFile(cached, resolvedOutputPath);
    return;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }

  const audio = new Uint8Array(await res.arrayBuffer());
  const cachedPath = await storeDownloadedBytes(url, audio, res.headers.get("content-type"));
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await copyFile(cachedPath, resolvedOutputPath);
}

async function cachedDownloadPath(url: string): Promise<string | null> {
  const paths = downloadCachePaths(url);
  return (await hasUsableFile(paths.filePath)) ? paths.filePath : null;
}

async function seedDownloadCache(url: string, sourcePath: string): Promise<void> {
  const paths = downloadCachePaths(url);
  if (await hasUsableFile(paths.filePath)) return;
  await mkdir(paths.dir, { recursive: true });
  const tempPath = `${paths.filePath}.${process.pid}.${Date.now()}.tmp`;
  await copyFile(sourcePath, tempPath);
  await renameOrIgnoreExisting(tempPath, paths.filePath);
  const bytes = await readFile(paths.filePath);
  await writeDownloadMetadata(url, paths.metadataPath, bytes, null);
}

async function storeDownloadedBytes(
  url: string,
  audio: Uint8Array,
  contentType: string | null,
): Promise<string> {
  const paths = downloadCachePaths(url);
  await mkdir(paths.dir, { recursive: true });
  const tempPath = `${paths.filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, audio);
  await renameOrIgnoreExisting(tempPath, paths.filePath);
  const bytes = await readFile(paths.filePath);
  await writeDownloadMetadata(url, paths.metadataPath, bytes, contentType);
  return paths.filePath;
}

async function renameOrIgnoreExisting(tempPath: string, finalPath: string): Promise<void> {
  try {
    await rename(tempPath, finalPath);
  } catch (err) {
    if (errorCode(err) !== "EEXIST") throw err;
  }
}

async function writeDownloadMetadata(
  url: string,
  metadataPath: string,
  bytes: Uint8Array,
  contentType: string | null,
): Promise<void> {
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        url,
        contentType,
        byteLength: bytes.byteLength,
        contentHash: sha256Bytes(bytes),
        cachedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function downloadCachePaths(url: string): { dir: string; filePath: string; metadataPath: string } {
  const dir = dataPath("downloads");
  const key = sha256Text(url);
  const extension = extensionFromUrl(url);
  return {
    dir,
    filePath: join(dir, `${key}${extension}`),
    metadataPath: join(dir, `${key}.json`),
  };
}

function extensionFromUrl(url: string): string {
  const extension = extname(new URL(url).pathname)
    .replace(/[^a-z0-9.]/gi, "")
    .toLowerCase();
  return extension || ".bin";
}

async function hasUsableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch (err) {
    if (errorCode(err) === "ENOENT") return false;
    throw err;
  }
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readTranscript(path: string): Promise<TimedTranscript> {
  return JSON.parse(await readFile(path, "utf8")) as TimedTranscript;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function titleFromUrl(url: string): string {
  const decoded = decodeURIComponent(basename(new URL(url).pathname));
  return stripExtension(decoded).replace(/\s+/g, " ").trim() || "Audio lesson";
}

function fileNameFromUrl(url: string): string {
  const decoded = decodeURIComponent(basename(new URL(url).pathname));
  const extension = extname(decoded) || ".mp3";
  const base = stripExtension(decoded)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "");
  return `${base || "source"}${extension}`;
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}
