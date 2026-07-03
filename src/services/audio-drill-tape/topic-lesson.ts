import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  FiloDocument,
  annotateSentences,
  annotateTranslation,
  annotateWords,
  type FiloAnnotation,
  type FiloDocumentJson,
  type SentencePayload,
  parseNyTimesArticleHtml,
} from "filo";
import { languageName } from "../../lib/languages.ts";
import { adminDb } from "../../lib/db/index.ts";
import { getAnthropicClient } from "../ai/client.ts";
import type { AudioProvider } from "../ai/audio/index.ts";
import { getAudioProvider } from "../ai/audio/index.ts";
import { renderLessonAudio } from "./render.ts";
import type {
  LanguagePayload,
  LessonSegmentPayload,
  LessonTapeMetadata,
  TopicLessonMetadata,
  TopicLessonSourceCardPayload,
  TopicLessonSentencePayload,
  TopicLessonSourcePayload,
} from "./types.ts";

export interface TopicLessonLearnerProfile {
  userId?: string;
  targetLanguage: string;
  baseLanguage: string;
  cefrLevel: string;
  knownVocabulary?: string[];
  grammarGaps?: string[];
}

export interface BuildTopicAudioLessonInput {
  topic?: string;
  sourceText?: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  sourceLanguage?: string;
  title?: string;
  outputDir: string;
  learner: TopicLessonLearnerProfile;
  renderAudio?: boolean;
  pauseMs?: number;
  maxSentences?: number;
  desiredRuntimeMinutes?: number;
  generationModel?: string;
  extraInformation?: string;
  audioProvider?: AudioProvider;
  contentGenerator?: TopicLessonContentGenerator;
  logger?: TopicLessonLogger;
}

export interface BuildTopicAudioLessonResult {
  source: FiloDocumentJson<TopicLessonMetadata>;
  lesson: FiloDocumentJson<LessonTapeMetadata>;
  sourceFiloPath: string;
  lessonFiloPath: string;
  outputAudioPath?: string;
}

export interface TopicLessonSentence {
  targetText: string;
  baseTranslation: string;
  explanation: string;
  explanationParts?: TopicLessonSpeechPart[];
  phrases?: TopicLessonPhrase[];
  quizPrompts?: TopicLessonQuizPrompt[];
}

export interface TopicLessonPhrase {
  targetText: string;
  baseTranslation: string;
  explanation: string;
  explanationParts?: TopicLessonSpeechPart[];
}

export interface TopicLessonQuizPrompt {
  prompt: string;
  promptParts?: TopicLessonSpeechPart[];
  answer: string;
}

export interface TopicLessonSpeechPart {
  language: "base" | "target";
  text: string;
}

export interface TopicLessonContent {
  title: string;
  sourceSummary: string;
  sentences: TopicLessonSentence[];
}

export interface TopicLessonContentGenerator {
  generate(input: TopicLessonContentInput): Promise<TopicLessonContent>;
}

export interface TopicLessonContentInput {
  topic: string;
  sourceText: string;
  sourceUrl?: string;
  sourceUrls: string[];
  sourceLanguage: string;
  targetLanguage: string;
  baseLanguage: string;
  cefrLevel: string;
  maxSentences?: number;
  desiredRuntimeMinutes?: number;
  generationModel?: string;
  extraInformation: string;
  sourceCards: TopicLessonSourceCard[];
  knownVocabulary: string[];
  grammarGaps: string[];
  logger?: TopicLessonLogger;
}

export interface TopicLessonLogEntry {
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

export type TopicLessonLogger = (entry: TopicLessonLogEntry) => void | Promise<void>;

interface DraftSegment {
  text: string;
  startIndex: number;
  endIndex: number;
  payload: LessonSegmentPayload;
}

const DEFAULT_RUNTIME_MINUTES = 5;
const DEFAULT_PAUSE_MS = 1200;
const DEFAULT_SHORT_PAUSE_MS = 700;
const DEFAULT_REVIEW_OFFSETS = [2, 5];
const TARGET_SPEECH_RATE = 0.75;
const MAX_SOURCE_TEXT_CHARS = 16_000;
const DEFAULT_GENERATION_MODEL = "claude-sonnet-4-6";
const SENTENCE_GENERATION_CONCURRENCY = 6;

export interface TopicLessonSourceCard {
  ordinal: number;
  sourceTierId: "sentence";
  sourceAnnotationId: string;
  sourceText: string;
  language: string;
}

export async function buildTopicAudioLesson(
  input: BuildTopicAudioLessonInput,
): Promise<BuildTopicAudioLessonResult> {
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  await emitLog(input.logger, {
    step: "filesystem",
    message: "Prepared topic lesson output directory.",
    data: { outputDir },
  });

  const topic = input.topic?.trim() || "Topic audio lesson";
  const sourceUrls = normalizedSourceUrls(input);
  await emitLog(input.logger, {
    step: "input",
    message: "Normalized topic lesson request.",
    data: {
      topic,
      sourceUrls,
      hasSourceText: !!input.sourceText?.trim(),
      requestedRuntimeMinutes: input.desiredRuntimeMinutes ?? null,
      generationModel: input.generationModel?.trim() || DEFAULT_GENERATION_MODEL,
      extraInformation: input.extraInformation?.trim() || null,
    },
  });
  const sourceText = await sourceTextForInput(input, sourceUrls, topic, input.logger);
  await emitLog(input.logger, {
    step: "source",
    message: "Prepared source text for adaptation.",
    data: {
      characters: sourceText.length,
      truncatedForPromptAt: MAX_SOURCE_TEXT_CHARS,
      promptCharacters: Math.min(sourceText.length, MAX_SOURCE_TEXT_CHARS),
    },
  });

  const sourceLanguage = input.sourceLanguage ?? input.learner.baseLanguage;
  const desiredRuntimeMinutes =
    input.desiredRuntimeMinutes === undefined
      ? undefined
      : clampRuntimeMinutes(input.desiredRuntimeMinutes);
  const maxSentences =
    input.maxSentences ??
    (desiredRuntimeMinutes === undefined
      ? undefined
      : maxSentencesForRuntime(desiredRuntimeMinutes, input.learner.cefrLevel));
  await emitLog(input.logger, {
    step: "planning",
    message:
      desiredRuntimeMinutes === undefined
        ? "Planning lesson with no runtime limit."
        : "Planning lesson size from desired runtime.",
    data: {
      desiredRuntimeMinutes: desiredRuntimeMinutes ?? null,
      maxSentenceCards: maxSentences ?? "all",
      cefrLevel: input.learner.cefrLevel,
      sourceLanguage,
      targetLanguage: input.learner.targetLanguage,
      baseLanguage: input.learner.baseLanguage,
    },
  });
  const provisionalTitle = input.title?.trim() || topic;
  const source = buildTopicSourceFilo({
    title: provisionalTitle,
    topic,
    sourceText,
    sourceLanguage,
    sourceUrls,
    targetLanguage: input.learner.targetLanguage,
    baseLanguage: input.learner.baseLanguage,
    cefrLevel: input.learner.cefrLevel,
    ...(desiredRuntimeMinutes !== undefined ? { desiredRuntimeMinutes } : {}),
    extraInformation: input.extraInformation?.trim() ?? "",
    ...(maxSentences !== undefined ? { maxSentenceCards: maxSentences } : {}),
  });
  const sourceCards = sourceCardsFromFilo(source);
  await emitLog(input.logger, {
    step: "filo",
    message: "Annotated topic source with Filo sentence boundaries.",
    data: {
      sourceDocumentId: source.id,
      sentenceCount: source.tiers.find((tier) => tier.id === "sentence")?.annotations.length ?? 0,
      sourceCardCount: sourceCards.length,
      maxSentenceCards: maxSentences ?? "all",
    },
  });
  const generator = input.contentGenerator ?? new ClaudeTopicLessonContentGenerator();
  const content = await generator.generate({
    topic,
    sourceText: sourceText.slice(0, MAX_SOURCE_TEXT_CHARS),
    ...(sourceUrls[0] ? { sourceUrl: sourceUrls[0] } : {}),
    sourceUrls,
    sourceLanguage,
    targetLanguage: input.learner.targetLanguage,
    baseLanguage: input.learner.baseLanguage,
    cefrLevel: input.learner.cefrLevel,
    ...(maxSentences !== undefined ? { maxSentences } : {}),
    ...(desiredRuntimeMinutes !== undefined ? { desiredRuntimeMinutes } : {}),
    generationModel: input.generationModel?.trim() || DEFAULT_GENERATION_MODEL,
    extraInformation: input.extraInformation?.trim() ?? "",
    sourceCards,
    knownVocabulary: input.learner.knownVocabulary ?? [],
    grammarGaps: input.learner.grammarGaps ?? [],
    logger: input.logger,
  });
  await emitLog(input.logger, {
    step: "generation",
    message: "Received structured topic lesson content.",
    data: {
      title: content.title,
      sourceSummary: content.sourceSummary,
      sentenceCount: content.sentences.length,
      preview: content.sentences.slice(0, 3),
    },
  });
  const title = input.title?.trim() || content.title || topic;

  const lesson = buildTopicLessonFilo(content, {
    title,
    topic,
    sourceDocumentId: source.id,
    sourceLanguage,
    sourceUrls,
    targetLanguage: input.learner.targetLanguage,
    baseLanguage: input.learner.baseLanguage,
    cefrLevel: input.learner.cefrLevel,
    ...(desiredRuntimeMinutes !== undefined ? { desiredRuntimeMinutes } : {}),
    extraInformation: input.extraInformation?.trim() ?? "",
    pauseMs: input.pauseMs ?? DEFAULT_PAUSE_MS,
  });

  const sourceFiloPath = join(outputDir, "source.filo.json");
  const lessonFiloPath = join(outputDir, "lesson.filo.json");
  await writeJson(sourceFiloPath, source);
  await emitLog(input.logger, {
    step: "filo",
    message: "Wrote source Filo document.",
    data: {
      sourceFiloPath,
      sourceDocumentId: source.id,
      sourceTiers: source.tiers.map((tier) => ({ id: tier.id, count: tier.annotations.length })),
    },
  });

  let renderedLesson = lesson;
  let outputAudioPath: string | undefined;
  if (input.renderAudio) {
    await emitLog(input.logger, {
      step: "audio",
      message: "Rendering lesson audio.",
      data: {
        provider: input.audioProvider?.name ?? getAudioProvider().name,
        outputDir,
      },
    });
    const rendered = await renderLessonAudio(lesson, {
      sourceAudioPath: join(outputDir, "topic-source.mp3"),
      outputDir,
      outputFileName: `${slugId(title)}.audio-drill.mp3`,
      audioProvider: input.audioProvider ?? getAudioProvider(),
      db: adminDb(),
    });
    renderedLesson = rendered.lesson;
    outputAudioPath = rendered.outputPath;
    await emitLog(input.logger, {
      step: "audio",
      message: "Rendered lesson audio.",
      data: {
        outputAudioPath,
        clipCount: rendered.clipPaths.length,
        generatedAudioAnnotations:
          renderedLesson.tiers.find((tier) => tier.id === "audio:generated")?.annotations.length ??
          0,
      },
    });
  } else {
    await emitLog(input.logger, {
      step: "audio",
      message: "Skipped audio rendering for this build.",
      data: { renderAudio: false },
    });
  }

  await writeJson(lessonFiloPath, renderedLesson);
  await emitLog(input.logger, {
    step: "filo",
    message: "Wrote lesson Filo document.",
    data: {
      lessonFiloPath,
      lessonDocumentId: renderedLesson.id,
      lessonTiers: renderedLesson.tiers.map((tier) => ({
        id: tier.id,
        count: tier.annotations.length,
      })),
    },
  });
  return {
    source,
    lesson: renderedLesson,
    sourceFiloPath,
    lessonFiloPath,
    ...(outputAudioPath ? { outputAudioPath } : {}),
  };
}

export class ClaudeTopicLessonContentGenerator implements TopicLessonContentGenerator {
  constructor(private readonly client = getAnthropicClient()) {}

  async generate(input: TopicLessonContentInput): Promise<TopicLessonContent> {
    const model = input.generationModel?.trim() || DEFAULT_GENERATION_MODEL;
    if (input.sourceCards.length === 0) {
      throw new Error("Topic lesson source annotator returned no sentence cards");
    }
    const concurrency = sentenceGenerationConcurrency(input);
    await emitLog(input.logger, {
      step: "generation",
      message: "Generating Filo sentence cards in parallel.",
      data: {
        cardCount: input.sourceCards.length,
        concurrency,
        model,
      },
    });
    const sentences = await mapWithConcurrency(
      input.sourceCards,
      concurrency,
      async (card, index) => {
        const prompt = promptForTopicLessonSentence(input, card, index);
        await emitLog(input.logger, {
          step: "prompt",
          message: "Built Claude sentence-card prompt.",
          data: {
            model,
            sentenceIndex: index,
            maxTokens: 2048,
            prompt,
          },
        });
        await emitLog(input.logger, {
          step: "model",
          message: "Calling Claude for one sentence card.",
          data: {
            model,
            sentenceIndex: index,
            tool: "topic_audio_lesson_sentence",
          },
        });
        const response = await this.client.messages.create({
          model,
          max_tokens: 2048,
          tools: [
            {
              name: "topic_audio_lesson_sentence",
              description: "Create one language-learning sentence card.",
              input_schema: topicSentenceSchema(),
            },
          ],
          tool_choice: { type: "tool" as const, name: "topic_audio_lesson_sentence" },
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        });
        await emitLog(input.logger, {
          step: "model",
          message: "Claude returned one sentence card.",
          data: {
            model,
            sentenceIndex: index,
            stopReason: response.stop_reason,
            contentBlocks: response.content.map((block) => block.type),
          },
        });
        const tool = response.content.find((block) => block.type === "tool_use");
        if (!tool || tool.type !== "tool_use") {
          throw new Error(`Topic lesson sentence ${index + 1} did not return structured output`);
        }
        return normalizeGeneratedSentence(tool.input, index);
      },
    );
    return {
      title: input.topic,
      sourceSummary: sourceSummaryForCards(input.sourceCards),
      sentences,
    };
  }
}

function buildTopicSourceFilo(input: {
  title: string;
  topic: string;
  sourceText: string;
  sourceLanguage: string;
  sourceUrls: string[];
  targetLanguage: string;
  baseLanguage: string;
  cefrLevel: string;
  desiredRuntimeMinutes?: number;
  extraInformation: string;
  maxSentenceCards?: number;
}): FiloDocumentJson<TopicLessonMetadata> {
  const document = FiloDocument.fromText<TopicLessonMetadata>(input.sourceText, {
    id: `audio-drill-topic-source:${slugId(input.title)}`,
    metadata: {
      corpus: "audio-drill-topic-source",
      title: input.title,
      topic: input.topic,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      baseLanguage: input.baseLanguage,
      learnerLevel: input.cefrLevel,
      ...(input.sourceUrls[0] ? { sourceUrl: input.sourceUrls[0] } : {}),
      ...(input.sourceUrls.length > 0 ? { sourceUrls: input.sourceUrls } : {}),
      ...(input.desiredRuntimeMinutes !== undefined
        ? { desiredRuntimeMinutes: input.desiredRuntimeMinutes }
        : {}),
      ...(input.extraInformation ? { extraInformation: input.extraInformation } : {}),
      createdAt: new Date().toISOString(),
    },
  });
  document.ensureTier<TopicLessonSourcePayload>({
    id: "source",
    kind: "custom",
    description: "Original source text used to generate a topic audio lesson",
    source: "langouste.audio-drill.topic",
  });
  document.addAnnotation<TopicLessonSourcePayload>("source", {
    start: 0,
    end: document.byteLength,
    source: "langouste.audio-drill.topic",
    payload: {
      topic: input.topic,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      baseLanguage: input.baseLanguage,
      ...(input.sourceUrls[0] ? { sourceUrl: input.sourceUrls[0] } : {}),
      ...(input.sourceUrls.length > 0 ? { sourceUrls: input.sourceUrls } : {}),
      ...(input.desiredRuntimeMinutes !== undefined
        ? { desiredRuntimeMinutes: input.desiredRuntimeMinutes }
        : {}),
      ...(input.extraInformation ? { extraInformation: input.extraInformation } : {}),
    },
  });
  annotateSentences(document, {
    language: input.sourceLanguage,
    source: "langouste.audio-drill.topic.source",
  });
  annotateWords(document, {
    language: input.sourceLanguage,
    source: "langouste.audio-drill.topic.source",
  });
  annotateTopicLessonSourceCards(document, {
    language: input.sourceLanguage,
    maxCards: input.maxSentenceCards,
  });
  return document.toJSON();
}

export function annotateTopicLessonSourceCards(
  document: FiloDocument,
  options: {
    language: string;
    maxCards?: number;
    tierId?: string;
    source?: string;
  },
): Array<FiloAnnotation<TopicLessonSourceCardPayload>> {
  const tierId = options.tierId ?? "topic.source-card";
  document.ensureTier<TopicLessonSourceCardPayload>({
    id: tierId,
    kind: "custom",
    description: "Filo sentence boundaries selected as topic lesson source cards",
    source: options.source ?? "langouste.audio-drill.topic.source-card",
  });

  const existing = document
    .requireTier<TopicLessonSourceCardPayload>(tierId)
    .annotations.sort((left, right) => left.payload.ordinal - right.payload.ordinal);
  if (existing.length > 0) return existing;

  let sentenceAnnotations =
    document
      .tier<SentencePayload>("sentence")
      ?.annotations.sort((left, right) => left.start - right.start) ?? [];
  if (sentenceAnnotations.length === 0) {
    sentenceAnnotations = annotateSentences(document, {
      language: options.language,
      source: options.source ?? "langouste.audio-drill.topic.source-card",
    });
  }

  const limit =
    options.maxCards === undefined
      ? sentenceAnnotations.length
      : Math.min(options.maxCards, sentenceAnnotations.length);
  const annotations: Array<FiloAnnotation<TopicLessonSourceCardPayload>> = [];
  for (const [ordinal, sentence] of sentenceAnnotations.slice(0, limit).entries()) {
    annotations.push(
      document.addAnnotation<TopicLessonSourceCardPayload>(tierId, {
        start: sentence.start,
        end: sentence.end,
        source: options.source ?? "langouste.audio-drill.topic.source-card",
        payload: {
          ordinal,
          text: document.textOf(sentence),
          language: options.language,
          sourceTierId: "sentence",
          sourceAnnotationId: sentence.id,
        },
      }),
    );
  }
  return annotations;
}

function sourceCardsFromFilo(
  source: FiloDocumentJson<TopicLessonMetadata>,
): TopicLessonSourceCard[] {
  const document = FiloDocument.fromJSON(source);
  return document
    .requireTier<TopicLessonSourceCardPayload>("topic.source-card")
    .annotations.sort((left, right) => left.payload.ordinal - right.payload.ordinal)
    .map((annotation) => ({
      ordinal: annotation.payload.ordinal,
      sourceTierId: annotation.payload.sourceTierId,
      sourceAnnotationId: annotation.payload.sourceAnnotationId,
      sourceText: document.textOf(annotation),
      language: annotation.payload.language,
    }));
}

function buildTopicLessonFilo(
  content: TopicLessonContent,
  options: {
    title: string;
    topic: string;
    sourceDocumentId: string;
    sourceLanguage: string;
    sourceUrls: string[];
    targetLanguage: string;
    baseLanguage: string;
    cefrLevel: string;
    desiredRuntimeMinutes?: number;
    extraInformation: string;
    pauseMs: number;
  },
): FiloDocumentJson<LessonTapeMetadata> {
  const segments: DraftSegment[] = [];
  let text = "";
  let order = 0;

  function append(segmentText: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) {
    const startIndex = text.length;
    text += segmentText;
    const endIndex = text.length;
    segments.push({
      text: segmentText,
      startIndex,
      endIndex,
      payload: { ...payload, segmentId: segmentId(order), order },
    });
    text += "\n\n";
    order += 1;
  }

  append(introText(options), {
    type: "intro",
    language: options.baseLanguage,
    audioSource: "tts",
  });

  const reviewQueue: Array<{ dueTurn: number; sentenceIndex: number; repetitionIndex: number }> =
    [];
  for (let index = 0; index < content.sentences.length; index += 1) {
    drainTopicReviews(reviewQueue, index, content.sentences, append, options);
    const sentence = content.sentences[index];
    if (!sentence) continue;
    appendTopicSentenceLesson(sentence, index, append, options);
    for (const [offsetIndex, offset] of DEFAULT_REVIEW_OFFSETS.entries()) {
      reviewQueue.push({
        dueTurn: index + offset,
        sentenceIndex: index,
        repetitionIndex: offsetIndex + 1,
      });
    }
  }
  appendCumulativeReview(content.sentences, append, options);
  drainTopicReviews(reviewQueue, Number.POSITIVE_INFINITY, content.sentences, append, options);

  append(outroText(options.baseLanguage), {
    type: "outro",
    language: options.baseLanguage,
    audioSource: "tts",
  });

  const trimmedText = text.trimEnd();
  const document = FiloDocument.fromText<LessonTapeMetadata>(trimmedText, {
    id: `audio-drill-topic:${slugId(options.title)}`,
    metadata: {
      corpus: "audio-drill-tape",
      lessonKind: "topic",
      title: options.title,
      topic: options.topic,
      sourceDocumentId: options.sourceDocumentId,
      sourceLanguage: options.sourceLanguage,
      bridgeLanguage: options.baseLanguage,
      targetLanguage: options.targetLanguage,
      learnerLevel: options.cefrLevel,
      ...(options.sourceUrls[0] ? { sourceUrl: options.sourceUrls[0] } : {}),
      ...(options.sourceUrls.length > 0 ? { sourceUrls: options.sourceUrls } : {}),
      ...(options.desiredRuntimeMinutes !== undefined
        ? { desiredRuntimeMinutes: options.desiredRuntimeMinutes }
        : {}),
      ...(options.extraInformation ? { extraInformation: options.extraInformation } : {}),
      generatedAt: new Date().toISOString(),
    },
  });
  defineTopicLessonTiers(document);

  const sentenceAnnotations: Array<FiloAnnotation<TopicLessonSentencePayload>> = [];
  for (const segment of segments) {
    const range = document.byteRangeForStringIndices(segment.startIndex, segment.endIndex);
    const annotation = document.addAnnotation<LessonSegmentPayload>("lesson.segment", {
      ...range,
      source: "langouste.audio-drill.topic",
      payload: segment.payload,
    });
    document.addAnnotation<LanguagePayload>("language", {
      start: annotation.start,
      end: annotation.end,
      source: "langouste.audio-drill.topic",
      payload: {
        language: segment.payload.language,
        level: segment.payload.type === "pause" ? "silence" : "segment",
        segmentId: segment.payload.segmentId,
      },
    });
    const sentenceIndex = sentenceIndexFromItemId(segment.payload.itemId);
    if (segment.payload.type === "source" && sentenceIndex !== null) {
      const generated = content.sentences[sentenceIndex];
      if (!generated) continue;
      if (sentenceAnnotations[sentenceIndex]) continue;
      sentenceAnnotations[sentenceIndex] = document.addAnnotation<TopicLessonSentencePayload>(
        "topic.sentence",
        {
          start: annotation.start,
          end: annotation.end,
          source: "langouste.audio-drill.topic",
          payload: {
            sentenceId: segment.payload.itemId ?? `sentence:${sentenceIndex}`,
            ordinal: sentenceIndex,
            targetText: generated.targetText,
            baseTranslation: generated.baseTranslation,
            explanation: generated.explanation,
            language: options.targetLanguage,
            baseLanguage: options.baseLanguage,
          },
        },
      );
      annotateTranslation(document, {
        start: annotation.start,
        end: annotation.end,
        language: options.baseLanguage,
        sourceLanguage: options.targetLanguage,
        text: generated.baseTranslation,
        source: "langouste.audio-drill.topic",
        payload: {
          level: "sentence",
          segmentId: segment.payload.segmentId,
          itemId: segment.payload.itemId,
        },
      });
    }
  }
  addTargetWordAnnotations(document, sentenceAnnotations, options.targetLanguage);
  return document.toJSON();
}

function appendTopicSentenceLesson(
  sentence: TopicLessonSentence,
  index: number,
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  options: {
    targetLanguage: string;
    baseLanguage: string;
    pauseMs: number;
  },
): void {
  const itemId = `sentence:${index}`;
  appendTarget(sentence.targetText, append, options.targetLanguage, {
    itemId,
    itemLevel: "sentence",
    type: "source",
    repetitionIndex: 0,
    promptTurn: index,
  });
  appendTarget(sentence.targetText, append, options.targetLanguage, {
    itemId,
    itemLevel: "sentence",
    type: "source",
    repetitionIndex: 0,
    promptTurn: index,
  });
  appendPause(append, DEFAULT_SHORT_PAUSE_MS, itemId, "sentence", index, "padding");
  appendBase(sentence.baseTranslation, append, options.baseLanguage, {
    itemId,
    itemLevel: "sentence",
    type: "meaning",
    repetitionIndex: 0,
    promptTurn: index,
  });
  if (sentence.explanationParts && sentence.explanationParts.length > 0) {
    appendSpeechParts(sentence.explanationParts, append, options, {
      itemId,
      itemLevel: "sentence",
      type: "explanation",
      repetitionIndex: 0,
      promptTurn: index,
    });
  } else {
    appendBase(sentence.explanation, append, options.baseLanguage, {
      itemId,
      itemLevel: "sentence",
      type: "explanation",
      repetitionIndex: 0,
      promptTurn: index,
    });
  }

  const phrases =
    sentence.phrases && sentence.phrases.length > 0
      ? sentence.phrases
      : [
          {
            targetText: sentence.targetText,
            baseTranslation: sentence.baseTranslation,
            explanation: sentence.explanation,
          },
        ];
  for (const [phraseIndex, phrase] of phrases.entries()) {
    const phraseId = `${itemId}:phrase:${phraseIndex}`;
    appendTarget(phrase.targetText, append, options.targetLanguage, {
      itemId: phraseId,
      itemLevel: "phrase",
      type: "source",
      repetitionIndex: 0,
      promptTurn: index,
    });
    appendBase(phrase.baseTranslation, append, options.baseLanguage, {
      itemId: phraseId,
      itemLevel: "phrase",
      type: "meaning",
      repetitionIndex: 0,
      promptTurn: index,
    });
    if (phrase.explanationParts && phrase.explanationParts.length > 0) {
      appendSpeechParts(phrase.explanationParts, append, options, {
        itemId: phraseId,
        itemLevel: "phrase",
        type: "explanation",
        repetitionIndex: 0,
        promptTurn: index,
      });
    } else {
      appendBase(phrase.explanation, append, options.baseLanguage, {
        itemId: phraseId,
        itemLevel: "phrase",
        type: "explanation",
        repetitionIndex: 0,
        promptTurn: index,
      });
    }
    appendTarget(phrase.targetText, append, options.targetLanguage, {
      itemId: phraseId,
      itemLevel: "phrase",
      type: "answer",
      repetitionIndex: 0,
      promptTurn: index,
    });
  }

  const quizPrompts =
    sentence.quizPrompts && sentence.quizPrompts.length > 0
      ? sentence.quizPrompts
      : [{ prompt: `Translate: ${sentence.baseTranslation}`, answer: sentence.targetText }];
  for (const [quizIndex, quiz] of quizPrompts.entries()) {
    const quizId = `${itemId}:quiz:${quizIndex}`;
    if (quiz.promptParts && quiz.promptParts.length > 0) {
      appendSpeechParts(quiz.promptParts, append, options, {
        itemId: quizId,
        itemLevel: "sentence",
        type: "recall_prompt",
        repetitionIndex: 0,
        promptTurn: index,
      });
    } else {
      appendBase(quiz.prompt, append, options.baseLanguage, {
        itemId: quizId,
        itemLevel: "sentence",
        type: "recall_prompt",
        repetitionIndex: 0,
        promptTurn: index,
      });
    }
    appendPause(append, options.pauseMs, itemId, "sentence", index, "response");
    appendTarget(quiz.answer, append, options.targetLanguage, {
      itemId,
      itemLevel: "sentence",
      type: "answer",
      repetitionIndex: 0,
      promptTurn: index,
    });
  }

  appendTarget(sentence.targetText, append, options.targetLanguage, {
    itemId,
    itemLevel: "sentence",
    type: "answer",
    repetitionIndex: 0,
    promptTurn: index,
  });
}

function drainTopicReviews(
  queue: Array<{ dueTurn: number; sentenceIndex: number; repetitionIndex: number }>,
  turn: number,
  sentences: TopicLessonSentence[],
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  options: {
    targetLanguage: string;
    baseLanguage: string;
    pauseMs: number;
  },
): void {
  queue.sort(
    (left, right) => left.dueTurn - right.dueTurn || left.sentenceIndex - right.sentenceIndex,
  );
  while (queue[0] && queue[0].dueTurn <= turn) {
    const review = queue.shift();
    if (!review) break;
    const sentence = sentences[review.sentenceIndex];
    if (!sentence) continue;
    const itemId = `sentence:${review.sentenceIndex}`;
    appendBase(`Review. Translate: ${sentence.baseTranslation}`, append, options.baseLanguage, {
      itemId,
      itemLevel: "sentence",
      type: "recall_prompt",
      repetitionIndex: review.repetitionIndex,
      promptTurn: review.dueTurn,
    });
    appendPause(append, options.pauseMs, itemId, "sentence", review.dueTurn, "response");
    appendTarget(sentence.targetText, append, options.targetLanguage, {
      itemId,
      itemLevel: "sentence",
      type: "answer",
      repetitionIndex: review.repetitionIndex,
      promptTurn: review.dueTurn,
    });
  }
}

function appendCumulativeReview(
  sentences: TopicLessonSentence[],
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  options: {
    targetLanguage: string;
    baseLanguage: string;
    pauseMs: number;
  },
): void {
  if (sentences.length === 0) return;
  appendBase("Now review the sentences from this lesson.", append, options.baseLanguage, {
    type: "repeat_prompt",
    repetitionIndex: 3,
    promptTurn: sentences.length,
  });
  for (const sentenceIndex of cumulativeReviewIndexes(sentences.length)) {
    const sentence = sentences[sentenceIndex];
    if (!sentence) continue;
    const itemId = `sentence:${sentenceIndex}`;
    appendBase(
      `Final review. Translate: ${sentence.baseTranslation}`,
      append,
      options.baseLanguage,
      {
        itemId,
        itemLevel: "sentence",
        type: "recall_prompt",
        repetitionIndex: 3,
        promptTurn: sentences.length + sentenceIndex,
      },
    );
    appendPause(
      append,
      options.pauseMs,
      itemId,
      "sentence",
      sentences.length + sentenceIndex,
      "response",
    );
    appendTarget(sentence.targetText, append, options.targetLanguage, {
      itemId,
      itemLevel: "sentence",
      type: "answer",
      repetitionIndex: 3,
      promptTurn: sentences.length + sentenceIndex,
    });
    const phrase = sentence.phrases?.[0];
    if (phrase) {
      const phraseId = `${itemId}:phrase:review`;
      appendBase(
        `Phrase review. Translate: ${phrase.baseTranslation}`,
        append,
        options.baseLanguage,
        {
          itemId: phraseId,
          itemLevel: "phrase",
          type: "recall_prompt",
          repetitionIndex: 3,
          promptTurn: sentences.length + sentenceIndex,
        },
      );
      appendPause(
        append,
        Math.max(DEFAULT_SHORT_PAUSE_MS, Math.round(options.pauseMs * 0.75)),
        phraseId,
        "phrase",
        sentences.length + sentenceIndex,
        "response",
      );
      appendTarget(phrase.targetText, append, options.targetLanguage, {
        itemId: phraseId,
        itemLevel: "phrase",
        type: "answer",
        repetitionIndex: 3,
        promptTurn: sentences.length + sentenceIndex,
      });
    }
  }
}

function cumulativeReviewIndexes(length: number): number[] {
  if (length <= 12) return Array.from({ length }, (_, index) => index);
  const indexes = new Set<number>();
  for (let index = 0; index < Math.min(4, length); index += 1) indexes.add(index);
  const middleStart = Math.max(4, Math.floor(length / 2) - 2);
  for (let index = middleStart; index < Math.min(length, middleStart + 4); index += 1) {
    indexes.add(index);
  }
  for (let index = Math.max(0, length - 4); index < length; index += 1) indexes.add(index);
  return [...indexes].sort((left, right) => left - right);
}

function appendTarget(
  text: string,
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  language: string,
  payload: Partial<Omit<LessonSegmentPayload, "segmentId" | "order" | "language" | "audioSource">>,
): void {
  append(text, {
    type: payload.type ?? "source",
    language,
    audioSource: "tts",
    speechRate: TARGET_SPEECH_RATE,
    ...payload,
  });
}

function appendBase(
  text: string,
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  language: string,
  payload: Partial<Omit<LessonSegmentPayload, "segmentId" | "order" | "language" | "audioSource">>,
): void {
  append(text, {
    type: payload.type ?? "explanation",
    language,
    audioSource: "tts",
    ...payload,
  });
}

function appendSpeechParts(
  parts: TopicLessonSpeechPart[] | undefined,
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  options: { targetLanguage: string; baseLanguage: string },
  payload: Partial<Omit<LessonSegmentPayload, "segmentId" | "order" | "language" | "audioSource">>,
): void {
  for (const part of parts ?? []) {
    if (!part.text.trim()) continue;
    if (part.language === "target") {
      appendTarget(part.text, append, options.targetLanguage, payload);
    } else {
      appendBase(part.text, append, options.baseLanguage, payload);
    }
  }
}

function appendPause(
  append: (text: string, payload: Omit<LessonSegmentPayload, "segmentId" | "order">) => void,
  durationMs: number,
  itemId: string,
  itemLevel: "phrase" | "sentence",
  promptTurn: number,
  pauseRole: "padding" | "response",
): void {
  append(`[pause ${formatPauseSeconds(durationMs)}s]`, {
    type: "pause",
    language: "zxx",
    audioSource: "silence",
    itemId,
    itemLevel,
    durationMs,
    promptTurn,
    pauseRole,
  });
}

function defineTopicLessonTiers(document: FiloDocument): void {
  document.ensureTier<LessonSegmentPayload>({
    id: "lesson.segment",
    kind: "custom",
    description: "Ordered topic audio lesson segments",
    source: "langouste.audio-drill.topic",
  });
  document.ensureTier<LanguagePayload>({
    id: "language",
    kind: "language",
    description: "Language used by each generated topic lesson segment",
    source: "langouste.audio-drill.topic",
  });
  document.ensureTier<TopicLessonSentencePayload>({
    id: "topic.sentence",
    kind: "sentence",
    description: "Adapted target-language sentences with base-language lesson notes",
    source: "langouste.audio-drill.topic",
  });
  document.ensureTier<Record<string, unknown>>({
    id: "word",
    kind: "word",
    description: "Target-language word spans in the generated listening script",
    source: "langouste.audio-drill.topic",
  });
}

function addTargetWordAnnotations(
  document: FiloDocument,
  sentences: Array<FiloAnnotation<TopicLessonSentencePayload>>,
  language: string,
): void {
  let ordinal = 0;
  for (const sentence of sentences) {
    if (!sentence) continue;
    const sentenceText = document.textOf(sentence);
    for (const match of sentenceText.matchAll(
      /[\p{Letter}\p{Mark}\p{Number}]+(?:[’'_.-][\p{Letter}\p{Mark}\p{Number}]+)*/gu,
    )) {
      const surface = match[0];
      const localStart = match.index ?? 0;
      const start = document.stringIndexForByteOffset(sentence.start) + localStart;
      const end = start + surface.length;
      document.addAnnotation("word", {
        ...document.byteRangeForStringIndices(start, end),
        source: "langouste.audio-drill.topic",
        payload: {
          surface,
          normalized: language ? surface.toLocaleLowerCase(language) : surface.toLocaleLowerCase(),
          ordinal,
          language,
          sentenceId: sentence.payload.sentenceId,
        },
      });
      ordinal += 1;
    }
  }
}

function promptForTopicLessonSentence(
  input: TopicLessonContentInput,
  card: TopicLessonSourceCard,
  index: number,
): string {
  const targetName = languageName(input.targetLanguage);
  const baseName = languageName(input.baseLanguage);
  const levelGuidance = cefrPromptGuidance(input.cefrLevel);
  return `Write one structured language-learning transcript card.

Topic: ${input.topic}
Filo source sentence ${index + 1} of ${input.sourceCards.length}:
<source_sentence>
${card.sourceText}
</source_sentence>

Target language: ${targetName} (${input.targetLanguage})
Base language for translations/explanations: ${baseName} (${input.baseLanguage})
Learner level: ${input.cefrLevel} (${levelGuidance})
Extra instructions: ${input.extraInformation || "(none)"}

Output contract:
- targetText: one natural ${targetName} sentence adapted from exactly this source sentence and appropriate for ${input.cefrLevel}.
- baseTranslation: direct whole-sentence ${baseName} meaning.
- explanation: compact plain-text fallback summary in ${baseName}.
- explanationParts: ordered transcript fragments for the explanation. Each fragment must be language-tagged as "base" or "target".
- phrases: 2-5 teachable chunks. Each phrase has targetText, baseTranslation, explanation, and language-tagged explanationParts.
- quizPrompts: exactly 2 active-recall prompts. Each prompt has prompt, language-tagged promptParts, and a ${targetName} answer.

Good learning transcript design:
1. Translate the source sentence into natural ${targetName} appropriate for this learner.
2. Give the whole-sentence meaning in ${baseName}.
3. Break the target sentence into useful phrases, not isolated random words.
4. In explanations, connect meaning to form: word order, endings, negation, cases, agreement, useful vocabulary, or idiom only when relevant.
5. Use ${targetName} often inside explanations, but every ${targetName} word, phrase, ending, or example must be its own "target" part.
6. Use "base" parts for the surrounding ${baseName} explanation.
7. Make quiz prompts ask the learner to produce the whole sentence and one key phrase.

Rules:
- Keep A1/A2 wording short and concrete.
- Explain only grammar/vocabulary needed for this sentence.
- Do not add facts that are not present in the source sentence.
- Return only the requested transcript fields.`;
}

function cefrPromptGuidance(level: string): string {
  if (level === "A1") return "very simple sentence, common words, present tense when possible";
  if (level === "A2") return "simple sentence, everyday vocabulary, limited clauses";
  if (level === "B1") return "clear sentence with one main idea and teachable detail";
  if (level === "B2") return "natural sentence with some detail, but avoid dense syntax";
  if (level === "C1") return "natural phrasing with nuance and concise explanation";
  if (level === "C2") return "idiomatic phrasing with precise explanation";
  return "level-appropriate wording";
}

function sourceSummaryForCards(cards: TopicLessonSourceCard[]): string {
  return `Adapted from ${cards.length} Filo sentence ${cards.length === 1 ? "boundary" : "boundaries"}.`;
}

function sentenceGenerationConcurrency(input: TopicLessonContentInput): number {
  if (input.sourceCards.length === 0) return 0;
  if (input.desiredRuntimeMinutes === undefined && input.maxSentences === undefined) {
    return input.sourceCards.length;
  }
  return Math.min(SENTENCE_GENERATION_CONCURRENCY, input.sourceCards.length);
}

function normalizeGeneratedSentence(value: unknown, index: number): TopicLessonSentence {
  const item = value as Record<string, unknown>;
  const sentence = {
    targetText: stringValue(item.targetText),
    baseTranslation: stringValue(item.baseTranslation),
    explanation: stringValue(item.explanation),
    explanationParts: normalizeSpeechParts(item.explanationParts),
    phrases: normalizePhrases(item.phrases),
    quizPrompts: normalizeQuizPrompts(item.quizPrompts),
  };
  if (!sentence.targetText || !sentence.baseTranslation || !sentence.explanation) {
    throw new Error(`Topic lesson sentence ${index + 1} is incomplete`);
  }
  return sentence;
}

function topicSentenceSchema() {
  return {
    type: "object" as const,
    properties: {
      targetText: { type: "string" as const },
      baseTranslation: { type: "string" as const },
      explanation: { type: "string" as const },
      explanationParts: speechPartsSchema(),
      phrases: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            targetText: { type: "string" as const },
            baseTranslation: { type: "string" as const },
            explanation: { type: "string" as const },
            explanationParts: speechPartsSchema(),
          },
          required: ["targetText", "baseTranslation", "explanation", "explanationParts"],
        },
      },
      quizPrompts: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            prompt: { type: "string" as const },
            promptParts: speechPartsSchema(),
            answer: { type: "string" as const },
          },
          required: ["prompt", "promptParts", "answer"],
        },
      },
    },
    required: [
      "targetText",
      "baseTranslation",
      "explanation",
      "explanationParts",
      "phrases",
      "quizPrompts",
    ],
  };
}

function speechPartsSchema() {
  return {
    type: "array" as const,
    description:
      "Ordered transcript fragments. The renderer turns each fragment into Filo language/segment annotations.",
    items: {
      type: "object" as const,
      properties: {
        language: {
          type: "string" as const,
          enum: ["base", "target"],
          description: '"base" for learner-base-language text, "target" for target-language text.',
        },
        text: {
          type: "string" as const,
          description: "Transcript text for this language-tagged fragment.",
        },
      },
      required: ["language", "text"],
    },
  };
}

function normalizePhrases(value: unknown): TopicLessonPhrase[] {
  return Array.isArray(value)
    ? value
        .map((raw) => {
          const item = raw as Record<string, unknown>;
          return {
            targetText: stringValue(item.targetText),
            baseTranslation: stringValue(item.baseTranslation),
            explanation: stringValue(item.explanation),
            explanationParts: normalizeSpeechParts(item.explanationParts),
          };
        })
        .filter((item) => item.targetText && item.baseTranslation && item.explanation)
    : [];
}

function normalizeQuizPrompts(value: unknown): TopicLessonQuizPrompt[] {
  return Array.isArray(value)
    ? value
        .map((raw) => {
          const item = raw as Record<string, unknown>;
          return {
            prompt: stringValue(item.prompt),
            promptParts: normalizeSpeechParts(item.promptParts),
            answer: stringValue(item.answer),
          };
        })
        .filter((item) => item.prompt && item.answer)
    : [];
}

function normalizeSpeechParts(value: unknown): TopicLessonSpeechPart[] {
  return Array.isArray(value)
    ? value
        .map((raw) => {
          const item = raw as Record<string, unknown>;
          const language: TopicLessonSpeechPart["language"] =
            item.language === "target" ? "target" : "base";
          return {
            language,
            text: stringValue(item.text),
          };
        })
        .filter((item) => item.text)
    : [];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sourceTextForInput(
  input: BuildTopicAudioLessonInput,
  sourceUrls: string[],
  topic: string,
  logger?: TopicLessonLogger,
): Promise<string> {
  const parts: string[] = [];
  if (input.sourceText?.trim()) {
    await emitLog(logger, {
      step: "source",
      message: "Using inline source text.",
      data: { characters: input.sourceText.trim().length },
    });
    parts.push(input.sourceText.trim());
  }
  for (const url of sourceUrls) {
    await emitLog(logger, {
      step: "source",
      message: "Fetching source URL.",
      data: { url },
    });
    const text = normalizeSourceText(await fetchReadableText(url));
    await emitLog(logger, {
      step: "source",
      message: "Fetched source URL.",
      data: { url, characters: text.length },
    });
    if (text) parts.push(text);
  }
  if (parts.length > 0) return normalizeSourceText(parts.join("\n\n"));
  await emitLog(logger, {
    step: "source",
    message: "No source URLs provided; generating topic-only lesson with factuality guardrails.",
    data: { topic },
  });
  return `No source URLs were provided. Generate a general language-learning listening lesson for this topic without presenting unsourced current facts as verified news: ${topic}`;
}

function normalizedSourceUrls(input: BuildTopicAudioLessonInput): string[] {
  const urls = [...(input.sourceUrls ?? []), ...(input.sourceUrl ? [input.sourceUrl] : [])]
    .map((url) => url.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

function clampRuntimeMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RUNTIME_MINUTES;
  return Math.min(60, Math.max(1, Math.round(value)));
}

function maxSentencesForRuntime(runtimeMinutes: number, cefrLevel: string): number {
  const cardsPerMinute = ["A1", "A2"].includes(cefrLevel) ? 1.4 : 1.8;
  return Math.min(60, Math.max(3, Math.round(runtimeMinutes * cardsPerMinute)));
}

async function fetchReadableText(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("source URLs must be http or https");
  }
  const res = await fetch(parsed);
  if (!res.ok) throw new Error(`Failed to fetch sourceUrl: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (contentType.includes("text/plain") || contentType.includes("application/json")) {
    return body;
  }
  return articleTextFromHtml(body, parsed.toString()) || htmlToReadableText(body);
}

function articleTextFromHtml(html: string, url: string): string {
  const article = parseNyTimesArticleHtml(html, { url });
  const articleBlocks = articleParagraphBlocksFromHtml(html);
  const paragraphs = uniqueInOrder(
    (articleBlocks.length > 0 ? articleBlocks : article.paragraphs)
      .flatMap(articleTextBlocks)
      .map(cleanArticleTextBlock)
      .filter((paragraph) => articleTextBlockLooksUseful(paragraph)),
  );
  if (paragraphs.length === 0) return "";
  const title = article.title && article.title !== "Untitled article" ? article.title : "";
  return normalizeSourceText([title, ...paragraphs].filter(Boolean).join("\n\n"));
}

function articleParagraphBlocksFromHtml(html: string): string[] {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/iu);
  const source = articleMatch?.[1] ?? html;
  const blocks: string[] = [];
  for (const match of source.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/giu)) {
    const text = htmlFragmentToTextPreservingLines(match[1] ?? "");
    if (text.trim()) blocks.push(text);
  }
  return blocks;
}

function htmlFragmentToTextPreservingLines(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\b[^>]*>/giu, "\n")
      .replace(/<\/(?:p|div|section|article|h[1-6]|li)>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n[ \t]+/gu, "\n")
      .replace(/[ \t]{2,}/gu, " ")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
  );
}

function articleTextBlocks(text: string): string[] {
  return text
    .split(/\n+/u)
    .map((line) => normalizeSourceText(line))
    .filter(Boolean);
}

function cleanArticleTextBlock(text: string): string {
  return normalizeSourceText(
    text
      .replace(/\bSave this story\b/giu, " ")
      .replace(
        /^(?:Illustration|Photograph|Photo illustration|Image|Drawing|Artwork)\s+by\b.*$/iu,
        " ",
      )
      .replace(/[ \t]{2,}/gu, " "),
  );
}

function articleTextBlockLooksUseful(text: string): boolean {
  if (text.length < 12) return false;
  const lower = text.toLocaleLowerCase("en");
  if (
    [
      "skip to main content",
      "open navigation menu",
      "newsletter",
      "search",
      "advertisement",
      "subscribe",
      "save this story",
      "listen to this article",
      "read in app",
    ].some((phrase) => lower.includes(phrase))
  ) {
    return false;
  }
  if (
    /^(illustration|photograph|photo illustration|image|drawing|artwork)\s+by\b/iu.test(text) ||
    /^by\s+[A-Z][\p{Letter}'’. -]+$/u.test(text)
  ) {
    return false;
  }
  return /[\p{Letter}].*[\p{Letter}]/u.test(text);
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<(?:p|br|div|section|article|h[1-6]|li)\b[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+\n/gu, "\n")
    .replace(/\n\s+/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n");
}

function normalizeSourceText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function introText(options: { title: string; topic: string; targetLanguage: string }): string {
  return `Listening lesson: ${options.title}. Topic: ${options.topic}. First listen in ${languageName(options.targetLanguage)}, then hear the translation and notes.`;
}

function outroText(_baseLanguage: string): string {
  return "End of lesson.";
}

function formatPauseSeconds(ms: number): string {
  return (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1);
}

function segmentId(order: number): string {
  return `segment-${String(order).padStart(4, "0")}`;
}

function sentenceIndexFromItemId(itemId: string | undefined): number | null {
  const match = itemId?.match(/^sentence:(\d+)$/u);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "", 10);
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 8);
  return `${slug || "topic"}-${hash}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function emitLog(
  logger: TopicLessonLogger | undefined,
  entry: TopicLessonLogEntry,
): Promise<void> {
  await logger?.(entry);
}
