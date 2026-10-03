import {
  FiloDocument,
  annotateAudio,
  annotateTranslation,
  type ByteRange,
  type FiloAnnotation,
  type FiloDocumentJson,
} from "filo";
import { createHash } from "node:crypto";
import { languageName } from "../../lib/languages.ts";
import type { TranslationProvider } from "../ai/translation/index.ts";
import type {
  BuildLessonFiloOptions,
  LanguagePayload,
  LessonItem,
  LessonItemLevel,
  LessonPlanOverride,
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
  plannedDurationMs: number;
  scheduledReviewCount: number;
  emittedReviewCount: number;
  deferredReviewCount: number;
}

interface ReviewEvent {
  lessonSentence: LessonSentence;
  repetitionIndex: number;
  dueAtMs?: number;
  dueTurn?: number;
  scheduledIntervalMs?: number;
}

type ReviewSchedule =
  | { kind: "elapsed-time"; intervalsMs: number[] }
  | { kind: "legacy-turns"; offsets: number[] };

interface ResolvedLessonPlan {
  reviewPrompts: Map<string, string[]>;
  dialogue: LessonSentence[];
  metadata: LessonPlanOverride;
}

type SegmentContext = Pick<
  LessonSegmentPayload,
  | "responseMode"
  | "promptMode"
  | "dueAtMs"
  | "scheduledIntervalMs"
  | "activity"
  | "dialoguePass"
  | "dialogueIndex"
>;

interface WordAudioCandidate {
  annotation: FiloAnnotation<SourceWordPayload>;
  previousGapMs: number;
  nextGapMs: number;
  isolationScoreMs: number;
  surroundingGapMs: number;
}

interface PreparedSentenceCandidate {
  training: FiloAnnotation<TrainingSentencePayload>;
  source: FiloAnnotation<SourceSentencePayload>;
  words: Array<FiloAnnotation<SourceWordPayload>>;
  text: string;
  translation: string;
  normalizedText: string;
  teachingScore?: number;
  durationMs: number;
  durationPerWordMs: number;
  maximumInternalGapMs: number;
  boundaryIsolationMs: number;
}

const DEFAULT_MAX_SENTENCES = 12;
const DEFAULT_WORD_PAUSE_MS = 350;
const DEFAULT_TRANSITION_PAUSE_MS = 350;
const DEFAULT_REVIEW_INTERVALS_MS = [25_000, 120_000];
// ElevenLabs' trimmed narration averages about 250ms per spoken word for the
// concise prompts used here. Keeping this estimate close to rendered time is
// important: an overestimate makes an elapsed-time review arrive early in the
// finished tape even when it was on time in the draft clock.
const ESTIMATED_TTS_WORD_MS = 250;
const ESTIMATED_TTS_BASE_MS = 100;
const MIN_ESTIMATED_TTS_MS = 500;
// Source clips retain a small edge pad on both sides during rendering.
const ESTIMATED_SOURCE_EDGE_PADDING_MS = 160;
const RESPONSE_PAUSE_POLICIES = {
  imitation: { multiplier: 1.35, planningMs: 1200, minimumMs: 2400, maximumMs: 5500 },
  recall: { multiplier: 1.7, planningMs: 2000, minimumMs: 3300, maximumMs: 6500 },
} as const;

export async function buildLessonTapeFilo(
  sourceJson: FiloDocumentJson<SourceTranscriptMetadata>,
  provider: TranslationProvider,
  options: BuildLessonFiloOptions,
): Promise<FiloDocumentJson<LessonTapeMetadata>> {
  const sourceDocument = FiloDocument.fromJSON(sourceJson);
  const sourceLanguage = options.sourceLanguage;
  const bridgeLanguage = options.bridgeLanguage;
  const lessonSentences = applyCueOverrides(
    selectLessonSentences(
      sourceDocument,
      bridgeLanguage,
      sourceLanguage,
      options.maxItems ?? DEFAULT_MAX_SENTENCES,
      options.drillWords ?? false,
      options.targetTextOverrides,
      options.lessonPlan?.itemOrder,
    ),
    options.cueOverrides,
    sourceLanguage,
  );
  const lessonPlan = resolveLessonPlan(
    lessonSentences,
    options.lessonPlan,
    sourceLanguage,
    bridgeLanguage,
  );
  if (options.reviewIntervalsMs !== undefined && options.reviewOffsets !== undefined) {
    throw new Error("Choose reviewIntervalsMs or the legacy reviewOffsets, not both");
  }
  const reviewSchedule: ReviewSchedule =
    options.reviewOffsets !== undefined
      ? { kind: "legacy-turns", offsets: validReviewValues(options.reviewOffsets, "reviewOffsets") }
      : {
          kind: "elapsed-time",
          intervalsMs: validReviewValues(
            options.reviewIntervalsMs ?? DEFAULT_REVIEW_INTERVALS_MS,
            "reviewIntervalsMs",
          ),
        };
  const draft = buildLessonDraft(lessonSentences, {
    sourceLanguage,
    bridgeLanguage,
    pauseMs: options.pauseMs,
    wordPauseMs: options.wordPauseMs ?? DEFAULT_WORD_PAUSE_MS,
    transitionPauseMs: options.transitionPauseMs ?? DEFAULT_TRANSITION_PAUSE_MS,
    reviewSchedule,
    lessonPlan,
    drillWords: options.drillWords ?? false,
  });

  const metadata: LessonTapeMetadata = {
    corpus: "audio-drill-tape",
    title: options.title,
    sourceDocumentId: sourceJson.id,
    sourceLanguage,
    bridgeLanguage,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.sourceAudioPath ? { sourceAudioPath: options.sourceAudioPath } : {}),
    ...(options.pauseMs !== undefined ? { pauseMs: options.pauseMs } : {}),
    wordPauseMs: options.wordPauseMs ?? DEFAULT_WORD_PAUSE_MS,
    transitionPauseMs: options.transitionPauseMs ?? DEFAULT_TRANSITION_PAUSE_MS,
    reviewSchedule,
    plannedDurationMs: draft.plannedDurationMs,
    scheduledReviewCount: draft.scheduledReviewCount,
    emittedReviewCount: draft.emittedReviewCount,
    deferredReviewCount: draft.deferredReviewCount,
    lessonPlan: lessonPlan.metadata,
    lessonPlanItemIds: options.lessonPlan?.itemOrder
      ? lessonSentences.map((lessonSentence) => lessonSentence.sentence.itemId)
      : [],
    lessonPlanDialogueItemIds: lessonPlan.dialogue.map(
      (lessonSentence) => lessonSentence.sentence.itemId,
    ),
    sourceTakeCounts: Object.fromEntries(
      lessonSentences.map((lessonSentence) => [
        lessonSentence.sentence.itemId,
        sourceTakes(lessonSentence).length,
      ]),
    ),
    responsePausePolicy:
      options.pauseMs !== undefined
        ? { kind: "fixed", durationMs: options.pauseMs }
        : {
            kind: "mode-aware-answer-duration",
            imitation: RESPONSE_PAUSE_POLICIES.imitation,
            recall: RESPONSE_PAUSE_POLICIES.recall,
          },
    drillWords: options.drillWords ?? false,
    cueOverrideCount: Object.keys(options.cueOverrides ?? {}).length,
    targetTextOverrideCount: Object.keys(options.targetTextOverrides ?? {}).length,
    generatedAt: new Date().toISOString(),
  };
  const document = FiloDocument.fromText<LessonTapeMetadata>(draft.text, {
    id: `audio-drill-tape:${slugId(options.title)}`,
    metadata,
  });

  defineLessonTiers(document);
  const bridgeSegments: Array<FiloAnnotation<LessonSegmentPayload>> = [];
  const sourceItems = new Map(
    lessonSentences
      .flatMap((lessonSentence) => [
        lessonSentence.sentence,
        ...(lessonSentence.modelSentence ? [lessonSentence.modelSentence] : []),
        ...(lessonSentence.alternateSentences ?? []),
        ...lessonSentence.words,
      ])
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
          source: "langouste.audio-drill.lesson",
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

  if (options.annotateBridgeTranslations) {
    await annotateBridgeSegmentTranslations(document, provider, bridgeSegments, {
      sourceLanguage: bridgeLanguage,
      targetLanguage: sourceLanguage,
    });
  }

  return document.toJSON();
}

export function selectLessonSentences(
  sourceDocument: FiloDocument,
  bridgeLanguage: string,
  sourceLanguage: string,
  maxSentences: number,
  includeWords = false,
  targetTextOverrides?: Record<string, string>,
  itemOrder?: string[],
): LessonSentence[] {
  const orderedSourceSentences = sourceDocument
    .requireTier<SourceSentencePayload>("sentence")
    .annotations.toSorted(
      (left, right) => left.payload.startMs - right.payload.startMs || left.start - right.start,
    );
  const sourceSentences = new Map(
    orderedSourceSentences.map((annotation) => [annotation.id, annotation]),
  );
  const words = sourceDocument.requireTier<SourceWordPayload>("word").annotations;
  const isolatedWordAudio = includeWords
    ? isolatedWordAudioSources(sourceDocument, words, sourceLanguage)
    : new Map<string, WordAudioCandidate>();
  const normalizedTargetTextOverrides = new Map(
    Object.entries(targetTextOverrides ?? {}).map(
      ([rawText, correctedText]) =>
        [normalizedLessonText(rawText, sourceLanguage), correctedText.trim()] as const,
    ),
  );
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

  const prepared: PreparedSentenceCandidate[] = [];
  for (const trainingSentence of candidates) {
    if (!trainingSentence.payload.fullSentence) continue;
    if (trainingSentence.payload.lessonEligible === false) continue;
    if (!languageCodesMatch(trainingSentence.payload.language, sourceLanguage)) continue;
    const sourceSentence = sourceSentences.get(trainingSentence.payload.sourceAnnotationId);
    if (!sourceSentence) continue;
    if (sourceSentence.payload.endMs <= sourceSentence.payload.startMs) continue;

    const sentenceWords = words.filter((word) =>
      trainingSentence.payload.wordAnnotationIds.includes(word.id),
    );
    const rawText = sourceDocument.textOf(sourceSentence);
    const text =
      normalizedTargetTextOverrides.get(normalizedLessonText(rawText, sourceLanguage)) ||
      trainingSentence.payload.correctedText?.trim() ||
      rawText;
    const rawTranslation =
      trainingSentence.payload.translation?.trim() ||
      translationForAnnotation(sourceDocument, sourceSentence, bridgeLanguage)?.trim();
    const translation = rawTranslation ? spokenCue(rawTranslation) : undefined;
    const normalizedText = normalizedLessonText(text, sourceLanguage);
    if (!normalizedText || !translation) continue;
    if (normalizedLessonText(translation, bridgeLanguage) === normalizedText) continue;
    const durationMs = sourceSentence.payload.endMs - sourceSentence.payload.startMs;
    const lexicalWordCount = Math.max(1, lexicalWords(text).length);
    prepared.push({
      training: trainingSentence,
      source: sourceSentence,
      words: sentenceWords,
      text,
      translation,
      normalizedText,
      teachingScore: trainingSentence.payload.teachingScore,
      durationMs,
      durationPerWordMs: durationMs / lexicalWordCount,
      maximumInternalGapMs: maximumInternalGapMs(sentenceWords),
      boundaryIsolationMs: sentenceBoundaryIsolationMs(sourceSentence, orderedSourceSentences),
    });
  }

  const groups = new Map<string, PreparedSentenceCandidate[]>();
  for (const candidate of prepared) {
    const group = groups.get(candidate.normalizedText) ?? [];
    group.push(candidate);
    groups.set(candidate.normalizedText, group);
  }

  const grouped = [...groups.values()].map((group) =>
    prepareLessonSentenceGroup(group, {
      sourceDocument,
      bridgeLanguage,
      sourceLanguage,
      isolatedWordAudio,
      includeWords,
    }),
  );
  if (itemOrder !== undefined) {
    if (itemOrder.length === 0) {
      throw new Error("lessonPlan.itemOrder must contain at least one target text");
    }
    const byTarget = new Map(
      grouped.map((entry) => [
        normalizedLessonText(entry.lessonSentence.sentence.text, sourceLanguage),
        entry.lessonSentence,
      ]),
    );
    const seen = new Set<string>();
    return itemOrder.map((rawTarget, index) => {
      const target = requirePlanText(rawTarget, `lessonPlan.itemOrder[${index}]`);
      const normalized = normalizedLessonText(target, sourceLanguage);
      if (seen.has(normalized)) {
        throw new Error(`lessonPlan.itemOrder contains duplicate target: "${target}"`);
      }
      seen.add(normalized);
      const lessonSentence = byTarget.get(normalized);
      if (!lessonSentence) {
        throw new Error(
          `lessonPlan.itemOrder target is not an eligible exact timed source item: "${target}"`,
        );
      }
      return lessonSentence;
    });
  }
  const hasTeachingScores = grouped.some((entry) => entry.teachingScore !== undefined);
  const chosen = grouped
    .toSorted((left, right) =>
      hasTeachingScores
        ? (right.teachingScore ?? 0) - (left.teachingScore ?? 0) || left.ordinal - right.ordinal
        : left.ordinal - right.ordinal,
    )
    .slice(0, Math.max(0, maxSentences))
    .toSorted((left, right) => left.ordinal - right.ordinal);

  return chosen.map(({ lessonSentence }) => lessonSentence);
}

function spokenCue(translation: string): string {
  return translation
    .replace(/\s+(?:\/|\|)\s+.*$/u, "")
    .replace(/\s*\([^()]*(?:formal|informal|polite|literally|lit\.)[^()]*\)\s*$/iu, "")
    .trim();
}

function applyCueOverrides(
  lessonSentences: LessonSentence[],
  overrides: Record<string, string> | undefined,
  sourceLanguage: string,
): LessonSentence[] {
  if (!overrides || Object.keys(overrides).length === 0) return lessonSentences;
  const normalizedOverrides = new Map(
    Object.entries(overrides)
      .map(
        ([target, cue]) => [normalizedLessonText(target, sourceLanguage), spokenCue(cue)] as const,
      )
      .filter(([target, cue]) => target.length > 0 && cue.length > 0),
  );
  return lessonSentences.map((lessonSentence) => {
    const cue = normalizedOverrides.get(
      normalizedLessonText(lessonSentence.sentence.text, sourceLanguage),
    );
    if (!cue) return lessonSentence;
    return {
      ...lessonSentence,
      sentence: { ...lessonSentence.sentence, translation: cue },
      ...(lessonSentence.modelSentence
        ? { modelSentence: { ...lessonSentence.modelSentence, translation: cue } }
        : {}),
      ...(lessonSentence.alternateSentences
        ? {
            alternateSentences: lessonSentence.alternateSentences.map((take) => ({
              ...take,
              translation: cue,
            })),
          }
        : {}),
    };
  });
}

function resolveLessonPlan(
  lessonSentences: LessonSentence[],
  input: LessonPlanOverride | undefined,
  sourceLanguage: string,
  bridgeLanguage: string,
): ResolvedLessonPlan {
  if (!input) return { reviewPrompts: new Map(), dialogue: [], metadata: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("lessonPlan must be an object");
  }
  const unknownKeys = Object.keys(input).filter(
    (key) => !["itemOrder", "reviewPrompts", "dialogue"].includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`lessonPlan contains unknown field: ${unknownKeys[0]}`);
  }
  const selectedByTarget = new Map(
    lessonSentences.map((lessonSentence) => [
      normalizedLessonText(lessonSentence.sentence.text, sourceLanguage),
      lessonSentence,
    ]),
  );
  const resolveSelected = (rawTarget: unknown, path: string): LessonSentence => {
    const target = requirePlanText(rawTarget, path);
    const selected = selectedByTarget.get(normalizedLessonText(target, sourceLanguage));
    if (!selected) {
      throw new Error(`${path} target is not a selected exact timed source item: "${target}"`);
    }
    return selected;
  };

  const reviewPrompts = new Map<string, string[]>();
  const cleanedReviewPrompts: Record<string, string[]> = {};
  if (input.reviewPrompts !== undefined) {
    if (
      !input.reviewPrompts ||
      typeof input.reviewPrompts !== "object" ||
      Array.isArray(input.reviewPrompts)
    ) {
      throw new Error("lessonPlan.reviewPrompts must be an object of target text to prompt arrays");
    }
    const seenTargets = new Set<string>();
    for (const [rawTarget, rawPrompts] of Object.entries(input.reviewPrompts)) {
      const selected = resolveSelected(
        rawTarget,
        `lessonPlan.reviewPrompts[${JSON.stringify(rawTarget)}]`,
      );
      const normalizedTarget = normalizedLessonText(selected.sentence.text, sourceLanguage);
      if (seenTargets.has(normalizedTarget)) {
        throw new Error(
          `lessonPlan.reviewPrompts contains duplicate normalized target: "${rawTarget}"`,
        );
      }
      seenTargets.add(normalizedTarget);
      if (!Array.isArray(rawPrompts) || rawPrompts.length === 0) {
        throw new Error(`lessonPlan.reviewPrompts[${JSON.stringify(rawTarget)}] must be nonempty`);
      }
      const prompts = rawPrompts.map((rawPrompt, index) =>
        validateReviewPrompt(
          rawPrompt,
          `lessonPlan.reviewPrompts[${JSON.stringify(rawTarget)}][${index}]`,
          selected.sentence.text,
          sourceLanguage,
          bridgeLanguage,
        ),
      );
      reviewPrompts.set(selected.sentence.itemId, prompts);
      cleanedReviewPrompts[selected.sentence.text] = prompts;
    }
  }

  if (input.dialogue !== undefined && !Array.isArray(input.dialogue)) {
    throw new Error("lessonPlan.dialogue must be an array of selected exact target texts");
  }
  const dialogue = (input.dialogue ?? []).map((target, index) =>
    resolveSelected(target, `lessonPlan.dialogue[${index}]`),
  );
  return {
    reviewPrompts,
    dialogue,
    metadata: {
      ...(input.itemOrder
        ? {
            itemOrder: input.itemOrder.map((target, index) =>
              requirePlanText(target, `lessonPlan.itemOrder[${index}]`),
            ),
          }
        : {}),
      ...(Object.keys(cleanedReviewPrompts).length > 0
        ? { reviewPrompts: cleanedReviewPrompts }
        : {}),
      ...(input.dialogue ? { dialogue: dialogue.map((entry) => entry.sentence.text) } : {}),
    },
  };
}

function validateReviewPrompt(
  rawPrompt: unknown,
  path: string,
  targetText: string,
  sourceLanguage: string,
  bridgeLanguage: string,
): string {
  const prompt = requirePlanText(rawPrompt, path);
  const words = lexicalWords(prompt);
  if (prompt.length > 160 || words.length > 24) {
    throw new Error(`${path} must be concise (at most 160 characters and 24 words)`);
  }
  if (
    normalizedLessonText(prompt, bridgeLanguage) ===
    normalizedLessonText(targetText, sourceLanguage)
  ) {
    throw new Error(`${path} must be a bridge-language cue, not the target answer`);
  }
  return prompt;
}

function requirePlanText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a nonempty string`);
  }
  return value.trim();
}

function prepareLessonSentenceGroup(
  group: PreparedSentenceCandidate[],
  options: {
    sourceDocument: FiloDocument;
    bridgeLanguage: string;
    sourceLanguage: string;
    isolatedWordAudio: Map<string, WordAudioCandidate>;
    includeWords: boolean;
  },
): { lessonSentence: LessonSentence; ordinal: number; teachingScore?: number } {
  const answerCandidate = group.toSorted(compareNaturalAnswerTake)[0];
  if (!answerCandidate) throw new Error("Cannot prepare an empty lesson sentence group");
  const modelCandidate = chooseModelTake(group, answerCandidate);
  const ordinal = Math.min(...group.map((candidate) => candidate.training.payload.ordinal));
  const itemId = semanticItemId(answerCandidate.normalizedText);
  const sentence = toLessonItem(
    options.sourceDocument,
    answerCandidate.source,
    "sentence",
    options.bridgeLanguage,
    options.sourceLanguage,
    ordinal,
    answerCandidate.translation,
    undefined,
    answerCandidate.text,
    itemId,
  );
  const modelSentence =
    modelCandidate.source.id === answerCandidate.source.id
      ? undefined
      : toLessonItem(
          options.sourceDocument,
          modelCandidate.source,
          "sentence",
          options.bridgeLanguage,
          options.sourceLanguage,
          ordinal,
          answerCandidate.translation,
          undefined,
          answerCandidate.text,
          itemId,
        );
  const excludedTakeIds = new Set([
    answerCandidate.source.id,
    ...(modelCandidate.source.id === answerCandidate.source.id ? [] : [modelCandidate.source.id]),
  ]);
  const alternateSentences = group
    .filter(
      (candidate) =>
        !excludedTakeIds.has(candidate.source.id) &&
        candidate.maximumInternalGapMs <= 650 &&
        candidate.durationPerWordMs <= 900 &&
        candidate.durationMs <=
          Math.max(answerCandidate.durationMs * 2.2, answerCandidate.durationMs + 900),
    )
    .toSorted(compareNaturalAnswerTake)
    .map((candidate) =>
      toLessonItem(
        options.sourceDocument,
        candidate.source,
        "sentence",
        options.bridgeLanguage,
        options.sourceLanguage,
        ordinal,
        answerCandidate.translation,
        undefined,
        answerCandidate.text,
        itemId,
      ),
    );
  const lessonSentence: LessonSentence = {
    sentence,
    ...(modelSentence ? { modelSentence } : {}),
    ...(alternateSentences.length > 0 ? { alternateSentences } : {}),
    words: options.includeWords
      ? answerCandidate.words.map((word, index) =>
          toLessonItem(
            options.sourceDocument,
            word,
            "word",
            options.bridgeLanguage,
            options.sourceLanguage,
            index,
            undefined,
            options.isolatedWordAudio.get(word.id)?.annotation,
          ),
        )
      : [],
  };
  const teachingScores = group
    .map((candidate) => candidate.teachingScore)
    .filter((score): score is number => score !== undefined);
  return {
    lessonSentence,
    ordinal,
    ...(teachingScores.length > 0 ? { teachingScore: Math.max(...teachingScores) } : {}),
  };
}

function compareNaturalAnswerTake(
  left: PreparedSentenceCandidate,
  right: PreparedSentenceCandidate,
): number {
  return (
    answerTakePenalty(left) - answerTakePenalty(right) ||
    left.source.payload.startMs - right.source.payload.startMs
  );
}

function answerTakePenalty(candidate: PreparedSentenceCandidate): number {
  const internalGapPenalty = candidate.maximumInternalGapMs > 650 ? 10_000 : 0;
  const ratePenalty = Math.abs(candidate.durationPerWordMs - 380);
  const boundaryBonus = Math.min(300, candidate.boundaryIsolationMs) / 10;
  return internalGapPenalty + ratePenalty - boundaryBonus;
}

function chooseModelTake(
  group: PreparedSentenceCandidate[],
  answer: PreparedSentenceCandidate,
): PreparedSentenceCandidate {
  const clean = group.filter(
    (candidate) =>
      candidate.maximumInternalGapMs <= 500 &&
      candidate.durationPerWordMs <= 900 &&
      candidate.durationMs <= Math.max(answer.durationMs * 2.2, answer.durationMs + 900),
  );
  return (
    clean.toSorted(
      (left, right) => right.durationMs - left.durationMs || compareNaturalAnswerTake(left, right),
    )[0] ?? answer
  );
}

function maximumInternalGapMs(words: Array<FiloAnnotation<SourceWordPayload>>): number {
  let maximum = 0;
  const ordered = words.toSorted((left, right) => left.payload.startMs - right.payload.startMs);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    maximum = Math.max(maximum, current.payload.startMs - previous.payload.endMs);
  }
  return Math.max(0, maximum);
}

function sentenceBoundaryIsolationMs(
  sentence: FiloAnnotation<SourceSentencePayload>,
  ordered: Array<FiloAnnotation<SourceSentencePayload>>,
): number {
  const index = ordered.findIndex((candidate) => candidate.id === sentence.id);
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const before = previous
    ? Math.max(0, sentence.payload.startMs - previous.payload.endMs)
    : Number.POSITIVE_INFINITY;
  const after = next
    ? Math.max(0, next.payload.startMs - sentence.payload.endMs)
    : Number.POSITIVE_INFINITY;
  return Math.min(before, after);
}

function semanticItemId(normalizedText: string): string {
  return `sentence:${createHash("sha256").update(normalizedText).digest("hex").slice(0, 16)}`;
}

function lexicalWords(text: string): string[] {
  return text.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu) ?? [];
}

function normalizedLessonText(text: string, language: string): string {
  return text
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase(canonicalLanguageCode(language))
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function languageCodesMatch(left: string, right: string): boolean {
  return canonicalLanguageCode(left) === canonicalLanguageCode(right);
}

function canonicalLanguageCode(language: string): string {
  const code = language.trim().toLocaleLowerCase().replace(/_/gu, "-").split("-")[0] ?? "";
  const aliases: Record<string, string> = {
    deu: "de",
    eng: "en",
    fra: "fr",
    hun: "hu",
    ita: "it",
    nld: "nl",
    pol: "pl",
    por: "pt",
    rus: "ru",
    spa: "es",
    tur: "tr",
  };
  return aliases[code] ?? code;
}

function buildLessonDraft(
  lessonSentences: LessonSentence[],
  options: {
    sourceLanguage: string;
    bridgeLanguage: string;
    pauseMs?: number;
    wordPauseMs: number;
    transitionPauseMs: number;
    reviewSchedule: ReviewSchedule;
    lessonPlan: ResolvedLessonPlan;
    drillWords: boolean;
  },
): LessonDraft {
  const builder = new LessonDraftBuilder();
  let turn = 0;
  let order = 0;
  const queue: ReviewEvent[] = [];
  const takeRotator = new LessonTakeRotator();

  const targetLanguageName = languageName(canonicalLanguageCode(options.sourceLanguage));
  order = builder.append(
    `${targetLanguageName} practice. Say each phrase during the pause. On review, answer before the recording.`,
    {
      segmentId: segmentId(order),
      order,
      type: "intro",
      language: options.bridgeLanguage,
      audioSource: "tts",
    },
  );
  order = appendPause(
    builder,
    order,
    options.transitionPauseMs,
    undefined,
    undefined,
    turn,
    "transition",
  );
  if (options.lessonPlan.dialogue.length > 0) {
    order = appendDialoguePass(
      builder,
      options.lessonPlan.dialogue,
      takeRotator,
      order,
      turn,
      "opening",
      "First, listen.",
      options,
    );
  }

  for (const lessonSentence of lessonSentences) {
    order = drainDueReviews(builder, queue, takeRotator, turn, order, options);
    order = appendSentenceLesson(builder, lessonSentence, takeRotator, order, turn, options);
    if (options.reviewSchedule.kind === "elapsed-time") {
      for (const [index, intervalMs] of options.reviewSchedule.intervalsMs.entries()) {
        queue.push({
          dueAtMs: builder.plannedElapsedMs + intervalMs,
          scheduledIntervalMs: intervalMs,
          lessonSentence,
          repetitionIndex: index + 1,
        });
      }
    } else {
      for (const [index, offset] of options.reviewSchedule.offsets.entries()) {
        queue.push({
          dueTurn: turn + offset,
          lessonSentence,
          repetitionIndex: index + 1,
        });
      }
    }
    turn += 1;
  }

  const scheduledReviewCount = queue.length + builder.emittedReviewCount;
  order = drainDueReviews(builder, queue, takeRotator, turn, order, options);
  const deferredReviewCount = queue.length;

  if (options.lessonPlan.dialogue.length > 0) {
    order = appendDialoguePass(
      builder,
      options.lessonPlan.dialogue,
      takeRotator,
      order,
      turn,
      "closing",
      "Now listen again.",
      options,
    );
  }

  order = builder.append("End of lesson.", {
    segmentId: segmentId(order),
    order,
    type: "outro",
    language: options.bridgeLanguage,
    audioSource: "tts",
  });
  void order;

  return builder.toDraft({ scheduledReviewCount, deferredReviewCount });
}

function appendDialoguePass(
  builder: LessonDraftBuilder,
  dialogue: LessonSentence[],
  takeRotator: LessonTakeRotator,
  order: number,
  turn: number,
  pass: "opening" | "closing",
  cue: string,
  options: { bridgeLanguage: string; transitionPauseMs: number },
): number {
  order = builder.append(cue, {
    segmentId: segmentId(order),
    order,
    type: "explanation",
    language: options.bridgeLanguage,
    audioSource: "tts",
    activity: "dialogue",
    dialoguePass: pass,
  });
  order = appendPause(
    builder,
    order,
    options.transitionPauseMs,
    undefined,
    undefined,
    turn,
    "transition",
    { activity: "dialogue", dialoguePass: pass },
  );
  for (const [index, lessonSentence] of dialogue.entries()) {
    order = appendSource(builder, takeRotator.next(lessonSentence), order, "source", 0, turn, {
      activity: "dialogue",
      dialoguePass: pass,
      dialogueIndex: index,
    });
    order = appendPause(
      builder,
      order,
      options.transitionPauseMs,
      undefined,
      undefined,
      turn,
      "transition",
      { activity: "dialogue", dialoguePass: pass, dialogueIndex: index },
    );
  }
  return order;
}

function appendSentenceLesson(
  builder: LessonDraftBuilder,
  lessonSentence: LessonSentence,
  takeRotator: LessonTakeRotator,
  order: number,
  turn: number,
  options: {
    sourceLanguage: string;
    bridgeLanguage: string;
    pauseMs?: number;
    wordPauseMs: number;
    transitionPauseMs: number;
    drillWords: boolean;
  },
): number {
  const sentence = lessonSentence.sentence;
  order = builder.append(sentence.translation, {
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
  order = appendPause(
    builder,
    order,
    options.transitionPauseMs,
    sentence.itemId,
    "sentence",
    turn,
    "transition",
  );
  order = appendSource(builder, takeRotator.next(lessonSentence), order, "source", 0, turn);
  order = appendPause(
    builder,
    order,
    responsePauseMs(sentence, options.pauseMs, "imitation"),
    sentence.itemId,
    "sentence",
    turn,
    "response",
    { responseMode: "imitation" },
  );
  order = appendSource(builder, takeRotator.next(lessonSentence), order, "answer", 0, turn);
  order = appendPause(
    builder,
    order,
    options.transitionPauseMs,
    sentence.itemId,
    "sentence",
    turn,
    "transition",
  );

  for (const word of options.drillWords ? lessonSentence.words : []) {
    order = builder.append(word.translation, {
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
    order = appendPause(
      builder,
      order,
      options.transitionPauseMs,
      word.itemId,
      "word",
      turn,
      "transition",
    );
    order = appendSource(builder, word, order, "source", 0, turn);
    order = appendPause(
      builder,
      order,
      responsePauseMs(word, options.pauseMs, "imitation"),
      word.itemId,
      "word",
      turn,
      "response",
      { responseMode: "imitation" },
    );
    order = appendSource(builder, word, order, "answer", 0, turn);
    order = appendPause(
      builder,
      order,
      options.wordPauseMs,
      word.itemId,
      "word",
      turn,
      "transition",
    );
  }
  return order;
}

function drainDueReviews(
  builder: LessonDraftBuilder,
  queue: ReviewEvent[],
  takeRotator: LessonTakeRotator,
  turn: number,
  order: number,
  options: {
    sourceLanguage: string;
    bridgeLanguage: string;
    pauseMs?: number;
    wordPauseMs: number;
    transitionPauseMs: number;
    reviewSchedule: ReviewSchedule;
    lessonPlan: ResolvedLessonPlan;
    drillWords: boolean;
  },
): number {
  queue.sort(compareReviewEvents);
  while (queue[0] && reviewIsDue(queue[0], builder.plannedElapsedMs, turn)) {
    const event = queue.shift();
    if (!event) break;
    order = appendSentenceReview(builder, event, takeRotator, order, turn, options);
    builder.noteEmittedReview();
  }
  return order;
}

function appendSentenceReview(
  builder: LessonDraftBuilder,
  event: ReviewEvent,
  takeRotator: LessonTakeRotator,
  order: number,
  turn: number,
  options: {
    sourceLanguage: string;
    bridgeLanguage: string;
    pauseMs?: number;
    transitionPauseMs: number;
    lessonPlan: ResolvedLessonPlan;
  },
): number {
  const sentence = event.lessonSentence.sentence;
  const curatedPrompts = options.lessonPlan.reviewPrompts.get(sentence.itemId);
  const curatedPrompt = curatedPrompts?.[(event.repetitionIndex - 1) % curatedPrompts.length];
  const promptMode = curatedPrompt ? "situation" : "translation";
  order = builder.append(curatedPrompt ?? sentence.translation, {
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
    promptTurn: event.dueTurn ?? turn,
    ...(event.dueAtMs !== undefined ? { dueAtMs: event.dueAtMs } : {}),
    ...(event.scheduledIntervalMs !== undefined
      ? { scheduledIntervalMs: event.scheduledIntervalMs }
      : {}),
    promptMode,
  });
  order = appendPause(
    builder,
    order,
    responsePauseMs(sentence, options.pauseMs, "recall"),
    sentence.itemId,
    "sentence",
    event.dueTurn ?? turn,
    "response",
    {
      responseMode: "recall",
      promptMode,
      ...(event.dueAtMs !== undefined ? { dueAtMs: event.dueAtMs } : {}),
      ...(event.scheduledIntervalMs !== undefined
        ? { scheduledIntervalMs: event.scheduledIntervalMs }
        : {}),
    },
  );
  order = appendSource(
    builder,
    takeRotator.next(event.lessonSentence),
    order,
    "answer",
    event.repetitionIndex,
    event.dueTurn ?? turn,
    {
      promptMode,
      ...(event.dueAtMs !== undefined ? { dueAtMs: event.dueAtMs } : {}),
      ...(event.scheduledIntervalMs !== undefined
        ? { scheduledIntervalMs: event.scheduledIntervalMs }
        : {}),
    },
  );
  order = appendPause(
    builder,
    order,
    options.transitionPauseMs,
    sentence.itemId,
    "sentence",
    event.dueTurn ?? turn,
    "transition",
  );
  return order;
}

function appendSource(
  builder: LessonDraftBuilder,
  item: LessonItem,
  order: number,
  type: "source" | "answer",
  repetitionIndex: number,
  promptTurn: number,
  context: SegmentContext = {},
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
    ...(context.dueAtMs !== undefined ? { dueAtMs: context.dueAtMs } : {}),
    ...(context.scheduledIntervalMs !== undefined
      ? { scheduledIntervalMs: context.scheduledIntervalMs }
      : {}),
    ...(context.promptMode ? { promptMode: context.promptMode } : {}),
    ...(context.activity ? { activity: context.activity } : {}),
    ...(context.dialoguePass ? { dialoguePass: context.dialoguePass } : {}),
    ...(context.dialogueIndex !== undefined ? { dialogueIndex: context.dialogueIndex } : {}),
  });
}

function appendPause(
  builder: LessonDraftBuilder,
  order: number,
  pauseMs: number,
  itemId: string | undefined,
  itemLevel: LessonItemLevel | undefined,
  promptTurn: number,
  pauseRole: "padding" | "response" | "transition",
  timing: SegmentContext = {},
): number {
  return builder.append(`[pause ${formatPauseSeconds(pauseMs)}s]`, {
    segmentId: segmentId(order),
    order,
    type: "pause",
    language: "zxx",
    audioSource: "silence",
    ...(itemId ? { itemId } : {}),
    ...(itemLevel ? { itemLevel } : {}),
    durationMs: pauseMs,
    promptTurn,
    pauseRole,
    ...(timing.responseMode ? { responseMode: timing.responseMode } : {}),
    ...(timing.promptMode ? { promptMode: timing.promptMode } : {}),
    ...(timing.dueAtMs !== undefined ? { dueAtMs: timing.dueAtMs } : {}),
    ...(timing.scheduledIntervalMs !== undefined
      ? { scheduledIntervalMs: timing.scheduledIntervalMs }
      : {}),
    ...(timing.activity ? { activity: timing.activity } : {}),
    ...(timing.dialoguePass ? { dialoguePass: timing.dialoguePass } : {}),
    ...(timing.dialogueIndex !== undefined ? { dialogueIndex: timing.dialogueIndex } : {}),
  });
}

function responsePauseMs(
  item: LessonItem,
  fixedPauseMs: number | undefined,
  mode: keyof typeof RESPONSE_PAUSE_POLICIES,
): number {
  if (fixedPauseMs !== undefined) return fixedPauseMs;
  const answerDurationMs = Math.max(0, item.sourceEndMs - item.sourceStartMs);
  const policy = RESPONSE_PAUSE_POLICIES[mode];
  const calculated = answerDurationMs * policy.multiplier + policy.planningMs;
  const clamped = Math.min(policy.maximumMs, Math.max(policy.minimumMs, calculated));
  return Math.round(clamped / 100) * 100;
}

function compareReviewEvents(left: ReviewEvent, right: ReviewEvent): number {
  const leftDue = left.dueAtMs ?? left.dueTurn ?? Number.POSITIVE_INFINITY;
  const rightDue = right.dueAtMs ?? right.dueTurn ?? Number.POSITIVE_INFINITY;
  return (
    leftDue - rightDue ||
    left.lessonSentence.sentence.ordinal - right.lessonSentence.sentence.ordinal
  );
}

function reviewIsDue(event: ReviewEvent, plannedElapsedMs: number, turn: number): boolean {
  if (event.dueAtMs !== undefined) return event.dueAtMs <= plannedElapsedMs;
  if (event.dueTurn !== undefined) return event.dueTurn <= turn;
  return false;
}

function validReviewValues(values: number[], option: string): number[] {
  return values.map((value) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${option} must contain only non-negative integers`);
    }
    return value;
  });
}

function defineLessonTiers(document: FiloDocument): void {
  document.ensureTier<LessonSegmentPayload>({
    id: "lesson.segment",
    kind: "custom",
    description: "Ordered guided audio-drill tape segments",
    source: "langouste.audio-drill.lesson",
  });
  document.ensureTier<LanguagePayload>({
    id: "language",
    kind: "language",
    description: "Language used by each generated tape segment",
    source: "langouste.audio-drill.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "word",
    kind: "word",
    description: "Source-language word-level training spans",
    source: "langouste.audio-drill.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "sentence",
    kind: "sentence",
    description: "Source-language sentence-level training spans",
    source: "langouste.audio-drill.lesson",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "spaced-repetition",
    kind: "custom",
    description: "Recall schedule events embedded in the tape",
    source: "langouste.audio-drill.lesson",
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
    source: "langouste.audio-drill.lesson",
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
    source: "langouste.audio-drill.language",
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
    source: "langouste.audio-drill.lesson",
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
      plannedStartMs: payload.plannedStartMs ?? null,
      dueAtMs: payload.dueAtMs ?? null,
      scheduledIntervalMs: payload.scheduledIntervalMs ?? null,
      responseMode: payload.responseMode ?? null,
      promptMode: payload.promptMode ?? null,
    },
    source: "langouste.audio-drill.schedule",
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
    source: "langouste.audio-drill.source",
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
      source: "langouste.audio-drill.lesson",
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
  audioAnnotation?: FiloAnnotation<SourceWordPayload | SourceSentencePayload>,
  textOverride?: string,
  itemIdOverride?: string,
): LessonItem {
  const payload = annotation.payload;
  const audioPayload = audioAnnotation?.payload ?? payload;
  const text = textOverride ?? sourceDocument.textOf(annotation);
  return {
    itemId: itemIdOverride ?? `${level}:${annotation.id}`,
    level,
    text,
    translation:
      translationOverride ??
      translationForAnnotation(sourceDocument, annotation, bridgeLanguage) ??
      text,
    language: sourceLanguage,
    sourceTierId: audioAnnotation?.tierId ?? annotation.tierId,
    sourceAnnotationId: audioAnnotation?.id ?? annotation.id,
    sourceStartMs: audioPayload.startMs,
    sourceEndMs: audioPayload.endMs,
    ordinal,
  };
}

function isolatedWordAudioSources(
  sourceDocument: FiloDocument,
  words: Array<FiloAnnotation<SourceWordPayload>>,
  sourceLanguage: string,
): Map<string, WordAudioCandidate> {
  const sortedWords = [...words].sort(
    (left, right) => left.payload.startMs - right.payload.startMs || left.start - right.start,
  );
  const candidatesByKey = new Map<string, WordAudioCandidate[]>();

  for (let index = 0; index < sortedWords.length; index += 1) {
    const word = sortedWords[index];
    if (!word) continue;
    if (word.payload.endMs <= word.payload.startMs) continue;
    const key = normalizedWordKey(sourceDocument.textOf(word), sourceLanguage);
    if (!key) continue;
    const previous = sortedWords[index - 1];
    const next = sortedWords[index + 1];
    const previousGapMs =
      previous && previous.payload.endMs > 0
        ? Math.max(0, word.payload.startMs - previous.payload.endMs)
        : 0;
    const nextGapMs =
      next && next.payload.startMs > 0 ? Math.max(0, next.payload.startMs - word.payload.endMs) : 0;
    const candidate: WordAudioCandidate = {
      annotation: word,
      previousGapMs,
      nextGapMs,
      isolationScoreMs: Math.min(previousGapMs, nextGapMs),
      surroundingGapMs: previousGapMs + nextGapMs,
    };
    const candidates = candidatesByKey.get(key) ?? [];
    candidates.push(candidate);
    candidatesByKey.set(key, candidates);
  }

  const bestBySourceWord = new Map<string, WordAudioCandidate>();
  for (const word of words) {
    const key = normalizedWordKey(sourceDocument.textOf(word), sourceLanguage);
    if (!key) continue;
    const best = candidatesByKey.get(key)?.toSorted(compareWordAudioCandidate)[0];
    if (best) bestBySourceWord.set(word.id, best);
  }
  return bestBySourceWord;
}

function compareWordAudioCandidate(left: WordAudioCandidate, right: WordAudioCandidate): number {
  return (
    right.isolationScoreMs - left.isolationScoreMs ||
    right.surroundingGapMs - left.surroundingGapMs ||
    wordDurationMs(right.annotation) - wordDurationMs(left.annotation) ||
    left.annotation.payload.startMs - right.annotation.payload.startMs
  );
}

function wordDurationMs(annotation: FiloAnnotation<SourceWordPayload>): number {
  return annotation.payload.endMs - annotation.payload.startMs;
}

function normalizedWordKey(text: string, language: string): string {
  return text
    .trim()
    .toLocaleLowerCase(language)
    .normalize("NFC")
    .replace(/^[^\p{Letter}\p{Mark}\p{Number}]+/gu, "")
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+$/gu, "");
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

function formatPauseSeconds(pauseMs: number): string {
  const seconds = pauseMs / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/u, "");
}

function sourceTakes(lessonSentence: LessonSentence): LessonItem[] {
  const bySourceAnnotation = new Map<string, LessonItem>();
  for (const take of [
    ...(lessonSentence.modelSentence ? [lessonSentence.modelSentence] : []),
    lessonSentence.sentence,
    ...(lessonSentence.alternateSentences ?? []),
  ]) {
    if (!bySourceAnnotation.has(take.sourceAnnotationId)) {
      bySourceAnnotation.set(take.sourceAnnotationId, take);
    }
  }
  return [...bySourceAnnotation.values()];
}

class LessonTakeRotator {
  private readonly nextIndexByItem = new Map<string, number>();

  next(lessonSentence: LessonSentence): LessonItem {
    const takes = sourceTakes(lessonSentence);
    if (takes.length === 0) return lessonSentence.sentence;
    const nextIndex = this.nextIndexByItem.get(lessonSentence.sentence.itemId) ?? 0;
    this.nextIndexByItem.set(lessonSentence.sentence.itemId, nextIndex + 1);
    return takes[nextIndex % takes.length] ?? lessonSentence.sentence;
  }
}

class LessonDraftBuilder {
  private readonly parts: string[] = [];
  private readonly segmentList: DraftSegment[] = [];
  private textLength = 0;
  private elapsedMs = 0;
  private reviewCount = 0;

  get plannedElapsedMs(): number {
    return this.elapsedMs;
  }

  get emittedReviewCount(): number {
    return this.reviewCount;
  }

  noteEmittedReview(): void {
    this.reviewCount += 1;
  }

  append(text: string, payload: LessonSegmentPayload): number {
    if (this.parts.length > 0) {
      this.parts.push("\n");
      this.textLength += 1;
    }
    const startIndex = this.textLength;
    this.parts.push(text);
    this.textLength += text.length;
    const plannedDurationMs = plannedSegmentDurationMs(text, payload);
    const timedPayload: LessonSegmentPayload = {
      ...payload,
      plannedStartMs: this.elapsedMs,
      plannedDurationMs,
    };
    this.segmentList.push({
      text,
      startIndex,
      endIndex: this.textLength,
      payload: timedPayload,
    });
    this.elapsedMs += plannedDurationMs;
    return payload.order + 1;
  }

  toDraft(options: { scheduledReviewCount: number; deferredReviewCount: number }): LessonDraft {
    return {
      text: this.parts.join(""),
      segments: this.segmentList,
      plannedDurationMs: this.elapsedMs,
      scheduledReviewCount: options.scheduledReviewCount,
      emittedReviewCount: this.reviewCount,
      deferredReviewCount: options.deferredReviewCount,
    };
  }
}

function plannedSegmentDurationMs(text: string, payload: LessonSegmentPayload): number {
  if (payload.audioSource === "silence") return Math.max(0, payload.durationMs ?? 0);
  if (
    payload.audioSource === "source" &&
    payload.sourceStartMs !== undefined &&
    payload.sourceEndMs !== undefined
  ) {
    return Math.max(
      0,
      payload.sourceEndMs - payload.sourceStartMs + ESTIMATED_SOURCE_EDGE_PADDING_MS,
    );
  }
  const wordCount = text.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu)?.length ?? 0;
  return Math.max(
    MIN_ESTIMATED_TTS_MS,
    ESTIMATED_TTS_BASE_MS + Math.max(1, wordCount) * ESTIMATED_TTS_WORD_MS,
  );
}
