import { FiloDocument, type FiloDocumentJson } from "filo";
import { translateTexts } from "../ai/translator.ts";
import type { LessonSegmentPayload } from "../audio-drill-tape/index.ts";
import type { DubParagraph, PodcastDubMetadata } from "./types.ts";

export interface BuildPodcastDubFiloInput {
  title: string;
  sourceDocumentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceUrl: string;
  sourceAudioPath: string;
  feedUrl: string;
  episodeTitle: string;
  paragraphs: DubParagraph[];
  /** Silence duration between paragraphs. */
  transitionPauseMs?: number;
}

const DEFAULT_TRANSITION_PAUSE_MS = 600;

/**
 * Builds the interleaved dub segment sequence — per paragraph: target-language
 * narration, then the original clip, then per sentence: target-language
 * narration, then the original clip — as a Filo document whose `lesson.segment`
 * tier is renderable by the existing audio-drill-tape `renderLessonAudio`.
 */
export async function buildPodcastDubFilo(
  input: BuildPodcastDubFiloInput,
): Promise<FiloDocumentJson<PodcastDubMetadata>> {
  const paragraphTexts = input.paragraphs.map((paragraph) => paragraph.text);
  const paragraphTranslations = paragraphTexts.length
    ? await translateTexts(
        paragraphTexts,
        input.targetLanguage,
        `Translate podcast paragraphs from ${input.sourceLanguage} into ${input.targetLanguage} for a language-learner dub. Keep the meaning natural and complete.`,
      )
    : [];

  const sentenceTexts = input.paragraphs.flatMap((paragraph) =>
    paragraph.sentences.map((sentence) => sentence.text),
  );
  const sentenceTranslations = sentenceTexts.length
    ? await translateTexts(
        sentenceTexts,
        input.targetLanguage,
        `Translate individual podcast sentences from ${input.sourceLanguage} into ${input.targetLanguage} for a language-learner dub. Keep each translation natural and self-contained.`,
      )
    : [];

  const transitionPauseMs = input.transitionPauseMs ?? DEFAULT_TRANSITION_PAUSE_MS;
  const accumulator = new SegmentAccumulator();
  let sentenceCursor = 0;
  let order = 0;

  input.paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphTranslation = paragraphTranslations[paragraphIndex]?.trim() || paragraph.text;
    accumulator.append(paragraphTranslation, {
      segmentId: `p${paragraph.ordinal}-${input.targetLanguage}`,
      order: order++,
      type: "meaning",
      language: input.targetLanguage,
      audioSource: "tts",
    });
    accumulator.append(paragraph.text, {
      segmentId: `p${paragraph.ordinal}-${input.sourceLanguage}`,
      order: order++,
      type: "source",
      language: input.sourceLanguage,
      audioSource: "source",
      sourceStartMs: paragraph.startMs,
      sourceEndMs: paragraph.endMs,
    });

    for (const sentence of paragraph.sentences) {
      const sentenceTranslation = sentenceTranslations[sentenceCursor]?.trim() || sentence.text;
      sentenceCursor += 1;
      accumulator.append(sentenceTranslation, {
        segmentId: `p${paragraph.ordinal}-s${sentence.ordinal}-${input.targetLanguage}`,
        order: order++,
        type: "meaning",
        language: input.targetLanguage,
        audioSource: "tts",
      });
      accumulator.append(sentence.text, {
        segmentId: `p${paragraph.ordinal}-s${sentence.ordinal}-${input.sourceLanguage}`,
        order: order++,
        type: "source",
        language: input.sourceLanguage,
        audioSource: "source",
        sourceStartMs: sentence.startMs,
        sourceEndMs: sentence.endMs,
        sourceTierId: "sentence",
        sourceAnnotationId: sentence.sourceAnnotationId,
      });
    }

    if (paragraphIndex < input.paragraphs.length - 1) {
      accumulator.append("", {
        segmentId: `p${paragraph.ordinal}-pause`,
        order: order++,
        type: "pause",
        language: input.targetLanguage,
        audioSource: "silence",
        durationMs: transitionPauseMs,
        pauseRole: "transition",
      });
    }
  });

  const metadata: PodcastDubMetadata = {
    corpus: "podcast-dub",
    title: input.title,
    sourceDocumentId: input.sourceDocumentId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    sourceUrl: input.sourceUrl,
    sourceAudioPath: input.sourceAudioPath,
    feedUrl: input.feedUrl,
    episodeTitle: input.episodeTitle,
    generatedAt: new Date().toISOString(),
  };

  return accumulator.build(`podcast-dub:${slugId(input.title)}`, metadata);
}

interface DraftSegment {
  startIndex: number;
  endIndex: number;
  payload: LessonSegmentPayload;
}

/** Accumulates segment text into one buffer, since Filo annotation ranges must point into a single document text. */
class SegmentAccumulator {
  private text = "";
  private segments: DraftSegment[] = [];

  append(text: string, payload: LessonSegmentPayload): void {
    const startIndex = this.text.length;
    this.text += text;
    this.segments.push({ startIndex, endIndex: this.text.length, payload });
  }

  build<Metadata>(id: string, metadata: Metadata): FiloDocumentJson<Metadata> {
    const document = FiloDocument.fromText<Metadata>(this.text, { id, metadata });
    document.ensureTier<LessonSegmentPayload>({
      id: "lesson.segment",
      kind: "custom",
      description: "Podcast dub segment sequence",
      source: "langouste.podcast-dub",
    });
    for (const segment of this.segments) {
      const range = document.byteRangeForStringIndices(segment.startIndex, segment.endIndex);
      document.addAnnotation<LessonSegmentPayload>("lesson.segment", {
        ...range,
        payload: segment.payload,
        source: "langouste.podcast-dub",
      });
    }
    return document.toJSON();
  }
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "podcast-dub";
}
