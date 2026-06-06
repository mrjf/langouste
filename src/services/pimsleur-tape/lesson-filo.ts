import { annotateAudio } from "../../../filo/src/annotators/audio";
import { annotateTranslation } from "../../../filo/src/annotators/translation";
import { FiloDocument } from "../../../filo/src/document";
import type { ByteRange, FiloAnnotation, FiloDocumentJson } from "../../../filo/src/types";
import { languageName } from "../../lib/languages.ts";
import type { TranslationProvider } from "../ai/translation/index.ts";
import type {
  BuildLessonFiloOptions,
  LanguagePayload,
  LessonItem,
  LessonItemLevel,
  LessonSentence,
  LessonSegmentPayload,
  LessonTapeMetadata,
  SourceSentencePayload,
  SourceTranscriptMetadata,
  SourceWordPayload,
  TrainingSentencePayload,
} from "./types.ts";
import { translationForAnnotation } from "./source-filo.ts";

interface DraftSegment {
  text: string;
  startIndex: number;
  endIndex: number;
  payload: LessonSegmentPayload;
}

interface LessonDraft {
  text: string;
  segments: DraftSegment[];
}

interface ReviewEvent {
  dueTurn: number;
  sentence: LessonItem;
  repetitionIndex: number;
}

const DEFAULT_MAX_SENTENCES = 24;
const DEFAULT_PAUSE_MS = 3000;
const DEFAULT_REVIEW_OFFSETS = [2, 5, 10];

export async function buildLessonTapeFilo(
  sourceJson: FiloDocumentJson<SourceTranscriptMetadata>,
  provider: TranslationProvider,
  options: BuildLessonFiloOptions,
): Promise<FiloDocumentJson<LessonTapeMetadata>> {
  const sourceDocument = FiloDocument.fromJSON(sourceJson);
  const sourceLanguage = options.sourceLanguage;
  const bridgeLanguage = options.bridgeLanguage;
  const lessonSentences = selectLessonSentences(
    sourceDocument,
    bridgeLanguage,
    sourceLanguage,
    options.maxItems ?? DEFAULT_MAX_SENTENCES,
  );
  const draft = buildLessonDraft(lessonSentences, {
    sourceLanguage,
    bridgeLanguage,
    pauseMs: options.pauseMs ?? DEFAULT_PAUSE_MS,
    reviewOffsets: options.reviewOffsets ?? DEFAULT_REVIEW_OFFSETS,
  });

  const metadata: LessonTapeMetadata = {
    corpus: "pimsleur-tape",
    title: options.title,
    sourceDocumentId: sourceJson.id,
    sourceLanguage,
    bridgeLanguage,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.sourceAudioPath ? { sourceAudioPath: options.sourceAudioPath } : {}),
    generatedAt: new Date().toISOString(),
  };
  const document = FiloDocument.fromText<LessonTapeMetadata>(draft.text, {
    id: `pimsleur-tape:${slugId(options.title)}`,
    metadata,
  });

  defineLessonTiers(document);
  const bridgeSegments: Array<FiloAnnotation<LessonSegmentPayload>> = [];
  const sourceItems = new Map(
    lessonSentences
      .flatMap((lessonSentence) => [lessonSentence.sentence, ...lessonSentence.words])
      .map((item) => [item.itemId, item]),
  );

  for (const segment of draft.segments) {
    const range = document.byteRangeForStringIndices(segment.startIndex, segment.endIndex);
    const segmentAnnotation = addLessonSegment(document, range, segment.payload);
    addLanguageAnnotation(document, segmentAnnotation, segment.payload);
    addStructuralAnnotation(document, segmentAnnotation, segment.payload, sourceLanguage);
    addSpacedRepetitionAnnotation(document, segmentAnnotation, segment.payload);
    if (segment.payload.audioSource === "source")
      addSourceAudioAnnotation(document, segmentAnnotation);
    if (segment.payload.language === bridgeLanguage && segment.payload.audioSource === "tts") {
      bridgeSegments.push(segmentAnnotation);
    }
    if (segment.payload.language === sourceLanguage && segment.payload.itemId) {
      const item = sourceItems.get(segment.payload.itemId);
      if (item?.translation) {
        annotateTranslation(document, {
          start: segmentAnnotation.start,
          end: segmentAnnotation.end,
          language: bridgeLanguage,
          sourceLanguage,
          text: item.translation,
          source: "langouste.pimsleur.lesson",
          payload: {
            level: segment.payload.itemLevel ?? "segment",
            segmentId: segment.payload.segmentId,
            itemId: item.itemId,
            sourceAnnotationId: item.sourceAnnotationId,
            sourceTierId: item.sourceTierId,
          },
        });
      }
    }
  }

  await annotateBridgeSegmentTranslations(document, provider, bridgeSegments, {
    sourceLanguage: bridgeLanguage,
    targetLanguage: sourceLanguage,
  });

  return document.toJSON();
}

export function selectLessonSentences(
  sourceDocument: FiloDocument,
  bridgeLanguage: string,
  sourceLanguage: string,
  maxSentences: number,
): LessonSentence[] {
  const sourceSentences = new Map(
    sourceDocument
      .requireTier<SourceSentencePayload>("sentence")
      .annotations.map((annotation) => [annotation.id, annotation]),
  );
  const words = sourceDocument.requireTier<SourceWordPayload>("word").annotations;
  const trainingSentences = sourceDocument.tier<TrainingSentencePayload>("training.sentence");
  const candidates =
    trainingSentences?.annotations ??
    ([...sourceSentences.values()].map((annotation) => ({
      id: annotation.id,
      start: annotation.start,
      end: annotation.end,
      tierId: "training.sentence",
      kind: "sentence",
      payload: {
        ...annotation.payload,
        fullSentence: true,
        sourceTierId: annotation.tierId,
        sourceAnnotationId: annotation.id,
      },
    })) as Array<FiloAnnotation<TrainingSentencePayload>>);

  const selected: LessonSentence[] = [];
  for (const trainingSentence of candidates) {
    if (selected.length >= maxSentences) break;
    if (!trainingSentence.payload.fullSentence) continue;
    if (trainingSentence.payload.language !== sourceLanguage) continue;
    const sourceSentence = sourceSentences.get(trainingSentence.payload.sourceAnnotationId);
    if (!sourceSentence) continue;
    if (sourceSentence.payload.endMs <= sourceSentence.payload.startMs) continue;

    const sentenceWords = words.filter((word) =>
      trainingSentence.payload.wordAnnotationIds.includes(word.id),
    );
    const sentenceItem = toLessonItem(
      sourceDocument,
      sourceSentence,
      "sentence",
      bridgeLanguage,
      sourceLanguage,
      selected.length,
      trainingSentence.payload.translation,
    );
    selected.push({
      sentence: sentenceItem,
      words: sentenceWords.map((word, index) =>
        toLessonItem(sourceDocument, word, "word", bridgeLanguage, sourceLanguage, index),
      ),
    });
  }

  return selected;
}

function buildLessonDraft(
  lessonSentences: LessonSentence[],
  options: {
    sourceLanguage: string;
    bridgeLanguage: string;
    pauseMs: number;
    reviewOffsets: number[];
  },
): LessonDraft {
  const builder = new LessonDraftBuilder();
  let turn = 0;
  let order = 0;
  const queue: ReviewEvent[] = [];

  order = builder.append(
    "This lesson uses the original recording. Listen to each sentence, then repeat during the pauses.",
    {
      segmentId: segmentId(order),
      order,
      type: "intro",
      language: options.bridgeLanguage,
      audioSource: "tts",
    },
  );

  for (const lessonSentence of lessonSentences) {
    order = drainDueReviews(builder, queue, turn, order, options);
    order = appendSentenceLesson(builder, lessonSentence, order, turn, options);
    for (const [index, offset] of options.reviewOffsets.entries()) {
      queue.push({
        dueTurn: turn + offset,
        sentence: lessonSentence.sentence,
        repetitionIndex: index + 1,
      });
    }
    turn += 1;
  }

  while (queue.length > 0) {
    const nextTurn = Math.min(...queue.map((event) => event.dueTurn));
    order = drainDueReviews(builder, queue, nextTurn, order, options);
  }

  order = builder.append("End of lesson.", {
    segmentId: segmentId(order),
    order,
    type: "outro",
    language: options.bridgeLanguage,
    audioSource: "tts",
  });
  void order;

  return builder.toDraft();
}

function appendSentenceLesson(
  builder: LessonDraftBuilder,
  lessonSentence: LessonSentence,
  order: number,
  turn: number,
  options: { sourceLanguage: string; bridgeLanguage: string; pauseMs: number },
): number {
  const sentence = lessonSentence.sentence;
  order = builder.append(`The whole sentence means: "${sentence.translation}".`, {
    segmentId: segmentId(order),
    order,
    type: "meaning",
    language: options.bridgeLanguage,
    audioSource: "tts",
    itemId: sentence.itemId,
    itemLevel: "sentence",
    sourceTierId: sentence.sourceTierId,
    sourceAnnotationId: sentence.sourceAnnotationId,
    repetitionIndex: 0,
    promptTurn: turn,
  });
  order = appendSource(builder, sentence, order, "source", 0, turn);

  for (const word of lessonSentence.words) {
    order = builder.append(`For "${word.translation}", listen:`, {
      segmentId: segmentId(order),
      order,
      type: "meaning",
      language: options.bridgeLanguage,
      audioSource: "tts",
      itemId: word.itemId,
      itemLevel: "word",
      sourceTierId: word.sourceTierId,
      sourceAnnotationId: word.sourceAnnotationId,
      repetitionIndex: 0,
      promptTurn: turn,
    });
    order = appendSource(builder, word, order, "source", 0, turn);
    order = builder.append("Repeat it.", {
      segmentId: segmentId(order),
      order,
      type: "repeat_prompt",
      language: options.bridgeLanguage,
      audioSource: "tts",
      itemId: word.itemId,
      itemLevel: "word",
      sourceTierId: word.sourceTierId,
      sourceAnnotationId: word.sourceAnnotationId,
      repetitionIndex: 0,
      promptTurn: turn,
    });
    order = appendPause(builder, order, options.pauseMs, word.itemId, "word", turn);
    order = appendSource(builder, word, order, "answer", 0, turn);
  }

  order = builder.append(`Now say the full sentence: "${sentence.translation}".`, {
    segmentId: segmentId(order),
    order,
    type: "recall_prompt",
    language: options.bridgeLanguage,
    audioSource: "tts",
    itemId: sentence.itemId,
    itemLevel: "sentence",
    sourceTierId: sentence.sourceTierId,
    sourceAnnotationId: sentence.sourceAnnotationId,
    repetitionIndex: 0,
    promptTurn: turn,
  });
  order = appendPause(builder, order, options.pauseMs, sentence.itemId, "sentence", turn);
  order = appendSource(builder, sentence, order, "answer", 0, turn);
  return order;
}

function drainDueReviews(
  builder: LessonDraftBuilder,
  queue: ReviewEvent[],
  turn: number,
  order: number,
  options: { sourceLanguage: string; bridgeLanguage: string; pauseMs: number },
): number {
  queue.sort(
    (left, right) => left.dueTurn - right.dueTurn || left.sentence.ordinal - right.sentence.ordinal,
  );
  while (queue[0] && queue[0].dueTurn <= turn) {
    const event = queue.shift();
    if (!event) break;
    order = appendSentenceReview(builder, event, order, options);
  }
  return order;
}

function appendSentenceReview(
  builder: LessonDraftBuilder,
  event: ReviewEvent,
  order: number,
  options: { sourceLanguage: string; bridgeLanguage: string; pauseMs: number },
): number {
  const sentence = event.sentence;
  order = builder.append(
    `How do you say "${sentence.translation}" in ${languageName(options.sourceLanguage)}?`,
    {
      segmentId: segmentId(order),
      order,
      type: "recall_prompt",
      language: options.bridgeLanguage,
      audioSource: "tts",
      itemId: sentence.itemId,
      itemLevel: "sentence",
      sourceTierId: sentence.sourceTierId,
      sourceAnnotationId: sentence.sourceAnnotationId,
      repetitionIndex: event.repetitionIndex,
      promptTurn: event.dueTurn,
    },
  );
  order = appendPause(builder, order, options.pauseMs, sentence.itemId, "sentence", event.dueTurn);
  order = appendSource(builder, sentence, order, "answer", event.repetitionIndex, event.dueTurn);
  return order;
}

function appendSource(
  builder: LessonDraftBuilder,
  item: LessonItem,
  order: number,
  type: "source" | "answer",
  repetitionIndex: number,
  promptTurn: number,
): number {
  return builder.append(item.text, {
    segmentId: segmentId(order),
    order,
    type,
    language: item.language,
    audioSource: "source",
    itemId: item.itemId,
    itemLevel: item.level,
    sourceTierId: item.sourceTierId,
    sourceAnnotationId: item.sourceAnnotationId,
    sourceStartMs: item.sourceStartMs,
    sourceEndMs: item.sourceEndMs,
    repetitionIndex,
    promptTurn,
  });
}

function appendPause(
  builder: LessonDraftBuilder,
  order: number,
  pauseMs: number,
  itemId: string,
  itemLevel: LessonItemLevel,
  promptTurn: number,
): number {
  return builder.append(`[pause ${Math.round(pauseMs / 1000)}s]`, {
    segmentId: segmentId(order),
    order,
    type: "pause",
    language: "zxx",
    audioSource: "silence",
    itemId,
    itemLevel,
    durationMs: pauseMs,
    promptTurn,
  });
}

function defineLessonTiers(document: FiloDocument): void {
  document.ensureTier<LessonSegmentPayload>({
    id: "lesson.segment",
    kind: "custom",
    description: "Ordered Pimsleur-style tape segments",
    source: "langouste.pimsleur.lesson",
  });
  document.ensureTier<LanguagePayload>({
    id: "language",
    kind: "language",
    description: "Language used by each generated tape segment",
    source: "langouste.pimsleur.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "word",
    kind: "word",
    description: "Source-language word-level training spans",
    source: "langouste.pimsleur.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "sentence",
    kind: "sentence",
    description: "Source-language sentence-level training spans",
    source: "langouste.pimsleur.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "spaced-repetition",
    kind: "custom",
    description: "Recall schedule events embedded in the tape",
    source: "langouste.pimsleur.lesson",
  });
}

function addLessonSegment(
  document: FiloDocument,
  range: ByteRange,
  payload: LessonSegmentPayload,
): FiloAnnotation<LessonSegmentPayload> {
  return document.addAnnotation<LessonSegmentPayload>("lesson.segment", {
    ...range,
    payload,
    source: "langouste.pimsleur.lesson",
  });
}

function addLanguageAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<LessonSegmentPayload>,
  payload: LessonSegmentPayload,
): void {
  document.addAnnotation<LanguagePayload>("language", {
    start: annotation.start,
    end: annotation.end,
    payload: {
      language: payload.language,
      level: payload.type === "pause" ? "silence" : "segment",
      segmentId: payload.segmentId,
      ...(payload.sourceTierId ? { sourceTierId: payload.sourceTierId } : {}),
      ...(payload.sourceAnnotationId ? { sourceAnnotationId: payload.sourceAnnotationId } : {}),
    },
    source: "langouste.pimsleur.language",
  });
}

function addStructuralAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<LessonSegmentPayload>,
  payload: LessonSegmentPayload,
  sourceLanguage: string,
): void {
  if (payload.audioSource !== "source") return;
  if (payload.language !== sourceLanguage) return;
  const tierId = payload.itemLevel ?? "sentence";
  if (tierId === "phrase") return;
  document.addAnnotation(tierId, {
    start: annotation.start,
    end: annotation.end,
    payload: {
      text: document.textOf(annotation),
      language: payload.language,
      segmentId: payload.segmentId,
      itemId: payload.itemId,
      itemLevel: payload.itemLevel ?? "sentence",
      sourceTierId: payload.sourceTierId,
      sourceAnnotationId: payload.sourceAnnotationId,
      sourceStartMs: payload.sourceStartMs,
      sourceEndMs: payload.sourceEndMs,
    },
    source: "langouste.pimsleur.lesson",
  });
}

function addSpacedRepetitionAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<LessonSegmentPayload>,
  payload: LessonSegmentPayload,
): void {
  if (!payload.itemId) return;
  if (!["repeat_prompt", "recall_prompt", "pause", "answer"].includes(payload.type)) return;
  document.addAnnotation("spaced-repetition", {
    start: annotation.start,
    end: annotation.end,
    payload: {
      itemId: payload.itemId,
      itemLevel: payload.itemLevel,
      segmentId: payload.segmentId,
      phase: payload.type,
      repetitionIndex: payload.repetitionIndex ?? 0,
      promptTurn: payload.promptTurn ?? null,
    },
    source: "langouste.pimsleur.schedule",
  });
}

function addSourceAudioAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<LessonSegmentPayload>,
): void {
  const payload = annotation.payload;
  if (payload.sourceStartMs === undefined || payload.sourceEndMs === undefined) return;
  annotateAudio(document, {
    start: annotation.start,
    end: annotation.end,
    tierId: "audio:source",
    url:
      (document.metadata as LessonTapeMetadata).sourceUrl ??
      (document.metadata as LessonTapeMetadata).sourceAudioPath ??
      "",
    mimeType: "audio/mpeg",
    startMs: payload.sourceStartMs,
    endMs: payload.sourceEndMs,
    source: "langouste.pimsleur.source",
    payload: {
      segmentId: payload.segmentId,
      itemId: payload.itemId,
      itemLevel: payload.itemLevel,
      sourceTierId: payload.sourceTierId,
      sourceAnnotationId: payload.sourceAnnotationId,
      language: payload.language,
    },
  });
}

async function annotateBridgeSegmentTranslations(
  document: FiloDocument,
  provider: TranslationProvider,
  segments: Array<FiloAnnotation<LessonSegmentPayload>>,
  options: { sourceLanguage: string; targetLanguage: string },
): Promise<void> {
  if (segments.length === 0) return;
  const texts = segments.map((segment) => document.textOf(segment));
  const translations = await provider.translateTexts(
    texts,
    options.targetLanguage,
    `Translate generated ${options.sourceLanguage} audio lesson narration into ${options.targetLanguage}. Keep commands natural and concise.`,
  );
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const translation = translations[index]?.trim();
    if (!segment || !translation) continue;
    annotateTranslation(document, {
      start: segment.start,
      end: segment.end,
      language: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      text: translation,
      source: "langouste.pimsleur.lesson",
      payload: {
        level: "sentence",
        segmentId: segment.payload.segmentId,
        itemId: segment.payload.itemId,
        sourceTierId: segment.tierId,
        sourceAnnotationId: segment.id,
      },
    });
  }
}

function toLessonItem(
  sourceDocument: FiloDocument,
  annotation: FiloAnnotation<SourceWordPayload | SourceSentencePayload>,
  level: "word" | "sentence",
  bridgeLanguage: string,
  sourceLanguage: string,
  ordinal: number,
  translationOverride?: string,
): LessonItem {
  const payload = annotation.payload;
  const text = sourceDocument.textOf(annotation);
  return {
    itemId: `${level}:${annotation.id}`,
    level,
    text,
    translation:
      translationOverride ??
      translationForAnnotation(sourceDocument, annotation, bridgeLanguage) ??
      text,
    language: sourceLanguage,
    sourceTierId: annotation.tierId,
    sourceAnnotationId: annotation.id,
    sourceStartMs: payload.startMs,
    sourceEndMs: payload.endMs,
    ordinal,
  };
}

function segmentId(order: number): string {
  return `segment-${String(order + 1).padStart(4, "0")}`;
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "lesson";
}

class LessonDraftBuilder {
  private readonly parts: string[] = [];
  private readonly segmentList: DraftSegment[] = [];
  private textLength = 0;

  append(text: string, payload: LessonSegmentPayload): number {
    if (this.parts.length > 0) {
      this.parts.push("\n");
      this.textLength += 1;
    }
    const startIndex = this.textLength;
    this.parts.push(text);
    this.textLength += text.length;
    this.segmentList.push({
      text,
      startIndex,
      endIndex: this.textLength,
      payload,
    });
    return payload.order + 1;
  }

  toDraft(): LessonDraft {
    return {
      text: this.parts.join(""),
      segments: this.segmentList,
    };
  }
}
