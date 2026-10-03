import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FiloDocumentJson } from "filo";
import { adminDb } from "../../lib/db/index.ts";
import { getAudioProvider } from "../ai/audio/index.ts";
import { getTranscriptionProvider, type TimedTranscript } from "../ai/transcription/index.ts";
import {
  buildSourceTranscriptFilo,
  downloadAudioFile,
  renderLessonAudio,
  type LessonTapeMetadata,
} from "../audio-drill-tape/index.ts";
import { classifyAdParagraphs } from "./ad-classifier.ts";
import { buildPodcastDubFilo } from "./dub-filo.ts";
import { parsePodcastFeed, selectEpisode } from "./feed.ts";
import { groupIntoParagraphs } from "./segmenter.ts";
import type { PodcastDubMetadata } from "./types.ts";

export interface BuildPodcastDubInput {
  feedUrl: string;
  /** "latest" | episode index | episode guid. Defaults to "latest". */
  episodeSelector?: string;
  outputDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  title?: string;
  paragraphPauseMs?: number;
  transitionPauseMs?: number;
  renderAudio?: boolean;
}

export interface BuildPodcastDubResult {
  dub: FiloDocumentJson<PodcastDubMetadata>;
  sourceAudioPath: string;
  transcriptPath: string;
  sourceFiloPath: string;
  dubFiloPath: string;
  outputAudioPath?: string;
  droppedAdParagraphs: number;
}

export async function buildPodcastDub(input: BuildPodcastDubInput): Promise<BuildPodcastDubResult> {
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });

  const feedResponse = await fetch(input.feedUrl);
  if (!feedResponse.ok) {
    throw new Error(
      `Failed to fetch podcast feed ${input.feedUrl}: ${feedResponse.status} ${feedResponse.statusText}`,
    );
  }
  const episodes = parsePodcastFeed(await feedResponse.text());
  const episode = selectEpisode(episodes, input.episodeSelector ?? "latest");
  const title = input.title ?? episode.title;

  // Reuse a prior download/transcript in the same output dir so reruns don't pay for them again.
  const sourceAudioPath = join(outputDir, "episode.mp3");
  if (!existsSync(sourceAudioPath)) await downloadAudioFile(episode.enclosureUrl, sourceAudioPath);

  const transcriptPath = join(outputDir, "transcript.json");
  let transcript: TimedTranscript;
  if (existsSync(transcriptPath)) {
    transcript = JSON.parse(await readFile(transcriptPath, "utf8")) as TimedTranscript;
  } else {
    transcript = await getTranscriptionProvider().transcribe({
      audioPath: sourceAudioPath,
      sourceUrl: episode.enclosureUrl,
      language: input.sourceLanguage,
    });
    await writeJson(transcriptPath, transcript);
  }

  const source = buildSourceTranscriptFilo(transcript, {
    title,
    sourceLanguage: input.sourceLanguage,
    sourceUrl: episode.enclosureUrl,
    sourceAudioPath,
  });
  const sourceFiloPath = join(outputDir, "source.filo.json");
  await writeJson(sourceFiloPath, source);

  const paragraphs = groupIntoParagraphs(source, input.paragraphPauseMs);
  const adOrdinals = await classifyAdParagraphs(paragraphs, input.sourceLanguage);
  const contentParagraphs = paragraphs
    .filter((paragraph) => !adOrdinals.has(paragraph.ordinal))
    .map((paragraph, index) => ({ ...paragraph, ordinal: index }));

  let dub = await buildPodcastDubFilo({
    title,
    sourceDocumentId: source.id,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    sourceUrl: episode.enclosureUrl,
    sourceAudioPath,
    feedUrl: input.feedUrl,
    episodeTitle: episode.title,
    paragraphs: contentParagraphs,
    transitionPauseMs: input.transitionPauseMs,
  });

  let outputAudioPath: string | undefined;
  if (input.renderAudio ?? true) {
    // Podcast-dub source clips are nested (a paragraph's range contains its sentences' ranges), which
    // render.ts's neighbor-padding logic wasn't designed for, so padding is disabled here.
    const rendered = await renderLessonAudio(
      dub as unknown as FiloDocumentJson<LessonTapeMetadata>,
      {
        sourceAudioPath,
        outputDir,
        audioProvider: getAudioProvider(),
        db: adminDb(),
        sourceClipPaddingMs: 0,
      },
    );
    dub = rendered.lesson as unknown as FiloDocumentJson<PodcastDubMetadata>;
    outputAudioPath = rendered.outputPath;
  }

  const dubFiloPath = join(outputDir, "dub.filo.json");
  await writeJson(dubFiloPath, dub);

  return {
    dub,
    sourceAudioPath,
    transcriptPath,
    sourceFiloPath,
    dubFiloPath,
    droppedAdParagraphs: adOrdinals.size,
    ...(outputAudioPath ? { outputAudioPath } : {}),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
