import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { adminDb } from "../../lib/db/index.ts";
import type { AudioProvider } from "../ai/audio/index.ts";
import { getAudioProvider } from "../ai/audio/index.ts";
import type { TranslationProvider } from "../ai/translation/index.ts";
import { getTranslationProvider } from "../ai/translation/index.ts";
import type { TimedTranscript, TranscriptionProvider } from "../ai/transcription/index.ts";
import { getTranscriptionProvider } from "../ai/transcription/index.ts";
import { buildLessonTapeFilo } from "./lesson-filo.ts";
import { renderLessonAudio } from "./render.ts";
import {
  annotateSourceTranslations,
  annotateTrainingSentences,
  buildSourceTranscriptFilo,
} from "./source-filo.ts";
import {
  ClaudeSourceSentenceExtractor,
  type SourceSentenceExtractor,
} from "./sentence-extractor.ts";
import type { PimsleurTapeDocuments } from "./types.ts";

export interface BuildPimsleurTapeInput {
  sourceUrl: string;
  outputDir: string;
  sourceLanguage: string;
  bridgeLanguage?: string;
  title?: string;
  transcriptPath?: string;
  renderAudio?: boolean;
  maxItems?: number;
  pauseMs?: number;
  phraseMaxWords?: number;
  phrasePauseMs?: number;
  transcriptionProvider?: TranscriptionProvider;
  translationProvider?: TranslationProvider;
  audioProvider?: AudioProvider;
  sentenceExtractor?: SourceSentenceExtractor;
}

export interface BuildPimsleurTapeResult {
  documents: PimsleurTapeDocuments;
  sourceAudioPath: string;
  transcriptPath: string;
  sourceFiloPath: string;
  lessonFiloPath: string;
  outputAudioPath?: string;
}

export async function buildPimsleurTape(
  input: BuildPimsleurTapeInput,
): Promise<BuildPimsleurTapeResult> {
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
  const translatedSource = await annotateSourceTranslations(
    sourceBase,
    translationProvider,
    bridgeLanguage,
  );
  const sentenceExtractor = input.sentenceExtractor ?? new ClaudeSourceSentenceExtractor();
  const extractedSentences = await sentenceExtractor.extractSentences({
    source: translatedSource,
    sourceLanguage: input.sourceLanguage,
    bridgeLanguage,
  });
  const source = annotateTrainingSentences(translatedSource, extractedSentences, bridgeLanguage);
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
  });

  let outputAudioPath: string | undefined;
  if (input.renderAudio) {
    const rendered = await renderLessonAudio(lesson, {
      sourceAudioPath,
      outputDir,
      audioProvider: input.audioProvider ?? getAudioProvider(),
      db: adminDb(),
    });
    lesson = rendered.lesson;
    outputAudioPath = rendered.outputPath;
  }

  const lessonFiloPath = join(outputDir, "lesson.filo.json");
  await writeJson(lessonFiloPath, lesson);

  return {
    documents: { source, lesson },
    sourceAudioPath,
    transcriptPath,
    sourceFiloPath,
    lessonFiloPath,
    ...(outputAudioPath ? { outputAudioPath } : {}),
  };
}

export async function downloadAudioFile(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, new Uint8Array(await res.arrayBuffer()));
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
