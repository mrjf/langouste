import type { FiloAnnotation, FiloDocumentJson } from "filo";

export type TapeSegmentLanguage = string;
export type LessonItemLevel = "word" | "phrase" | "sentence";
export type LessonSegmentType =
  | "intro"
  | "meaning"
  | "explanation"
  | "source"
  | "repeat_prompt"
  | "recall_prompt"
  | "answer"
  | "pause"
  | "outro";
export type LessonAudioSource = "tts" | "source" | "silence";

export interface SourceTranscriptMetadata {
  [key: string]: unknown;
  corpus: "audio-drill-source-audio";
  title: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  language: string;
  transcriptionProvider: string;
  transcriptionModel: string;
  languageProbability?: number;
  createdAt: string;
}

export interface LessonTapeMetadata {
  [key: string]: unknown;
  corpus: "audio-drill-tape";
  lessonKind?: "source-audio" | "topic";
  title: string;
  sourceDocumentId: string;
  sourceLanguage: string;
  bridgeLanguage: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  generatedAt: string;
}

export interface TopicLessonMetadata {
  [key: string]: unknown;
  corpus: "audio-drill-topic-source";
  title: string;
  topic: string;
  sourceLanguage: string;
  targetLanguage: string;
  baseLanguage: string;
  learnerLevel: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  desiredRuntimeMinutes?: number;
  extraInformation?: string;
  createdAt: string;
}

export interface TopicLessonSourcePayload {
  topic: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  sourceLanguage: string;
  targetLanguage: string;
  baseLanguage: string;
  desiredRuntimeMinutes?: number;
  extraInformation?: string;
}

export interface TopicLessonSourceCardPayload {
  ordinal: number;
  text: string;
  language: string;
  sourceTierId: "sentence";
  sourceAnnotationId: string;
}

export interface TopicLessonSentencePayload {
  sentenceId: string;
  ordinal: number;
  targetText: string;
  baseTranslation: string;
  explanation: string;
  language: string;
  baseLanguage: string;
}

export interface TimedPayload {
  startMs: number;
  endMs: number;
}

export interface LanguagePayload {
  language: TapeSegmentLanguage;
  level?: LessonItemLevel | "segment" | "silence";
  sourceTierId?: string;
  sourceAnnotationId?: string;
  segmentId?: string;
}

export interface SourceWordPayload extends TimedPayload {
  surface: string;
  normalized: string;
  ordinal: number;
  language: string;
  speakerId?: string;
  logprob?: number;
}

export interface SourcePhrasePayload extends TimedPayload {
  label: string;
  phraseType: string;
  ordinal: number;
  language: string;
  wordAnnotationIds: string[];
  words: string[];
}

export interface SourceSentencePayload extends TimedPayload {
  text: string;
  ordinal: number;
  language: string;
  wordAnnotationIds: string[];
}

export interface TrainingSentencePayload extends SourceSentencePayload {
  fullSentence: boolean;
  sourceTierId: string;
  sourceAnnotationId: string;
  /** Orthography repaired without changing the words heard in the source audio. */
  correctedText?: string;
  translation?: string;
  reason?: string;
  /** Whether the utterance is suitable as a standalone lesson item. */
  lessonEligible?: boolean;
  /** 0-1 estimate of beginner usefulness, naturalness, and self-containedness. */
  teachingScore?: number;
  qualityFlags?: string[];
}

export interface LessonItem {
  itemId: string;
  level: LessonItemLevel;
  text: string;
  translation: string;
  language: string;
  sourceTierId: string;
  sourceAnnotationId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  ordinal: number;
}

export interface LessonSentence {
  sentence: LessonItem;
  /** An optional slower clean take used for the first model only. */
  modelSentence?: LessonItem;
  /** Additional independently timed clean takes with the same semantic item id. */
  alternateSentences?: LessonItem[];
  words: LessonItem[];
}

export interface LessonPlanOverride {
  /** Exact normalized target texts to select, in authoritative teaching order. */
  itemOrder?: string[];
  /** Reviewed target text to concise bridge-language situation prompts. */
  reviewPrompts?: Record<string, string[]>;
  /** Exact selected target texts forming the passive opening/closing dialogue. */
  dialogue?: string[];
}

export interface LessonSegmentPayload {
  segmentId: string;
  order: number;
  type: LessonSegmentType;
  language: string;
  audioSource: LessonAudioSource;
  itemId?: string;
  itemLevel?: LessonItemLevel;
  sourceTierId?: string;
  sourceAnnotationId?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  repetitionIndex?: number;
  promptTurn?: number;
  /** Planned lesson-clock position used by the elapsed-time review scheduler. */
  plannedStartMs?: number;
  /** Deterministic duration estimate used before speech clips have been rendered. */
  plannedDurationMs?: number;
  /** Absolute planned lesson-clock time at which a review becomes eligible. */
  dueAtMs?: number;
  /** Requested delay from initial presentation completion to this review. */
  scheduledIntervalMs?: number;
  durationMs?: number;
  pauseRole?: "padding" | "response" | "transition";
  responseMode?: "imitation" | "recall";
  promptMode?: "situation" | "translation";
  activity?: "dialogue";
  dialoguePass?: "opening" | "closing";
  dialogueIndex?: number;
  speechRate?: number;
}

export interface RenderedAudioPayload {
  [key: string]: unknown;
  url: string;
  mimeType: string;
  segmentId: string;
  order: number;
  language: string;
  audioSource: LessonAudioSource;
  clipPath?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
  clipStartMs?: number;
  clipEndMs?: number;
  sourceClipPaddingMs?: number;
  /** Exact probed duration of the rendered segment clip. */
  durationMs?: number;
  /** Exact position of this clip within the rendered concatenation timeline. */
  timelineStartMs?: number;
  /** Exact end position of this clip within the rendered concatenation timeline. */
  timelineEndMs?: number;
  normalization?: AudioNormalizationSettings;
  generatedAt: string;
}

export interface AudioNormalizationSettings {
  enabled: boolean;
  targetLufs: number;
  truePeakDb: number;
  loudnessRange: number;
  shortClipThresholdMs: number;
}

export interface BuildSourceFiloOptions {
  title: string;
  sourceLanguage: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  phraseMaxWords?: number;
  phrasePauseMs?: number;
}

export interface BuildLessonFiloOptions {
  title: string;
  sourceLanguage: string;
  bridgeLanguage: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  maxItems?: number;
  /** Fixed response window override. Omit to derive it from answer duration. */
  pauseMs?: number;
  /** Legacy word-drill padding. Word drills are disabled by default. */
  wordPauseMs?: number;
  transitionPauseMs?: number;
  /** Preferred review delays measured from presentation completion. */
  reviewIntervalsMs?: number[];
  /** Explicit legacy item-turn schedule. Omit to use elapsed-time intervals. */
  reviewOffsets?: number[];
  lessonPlan?: LessonPlanOverride;
  drillWords?: boolean;
  annotateBridgeTranslations?: boolean;
  /** Authoritative target-text → spoken bridge cue corrections, applied after ASR/LLM review. */
  cueOverrides?: Record<string, string>;
  /** Authoritative raw-ASR → corrected target text, applied before deduplication. */
  targetTextOverrides?: Record<string, string>;
}

export interface AudioDrillTapeDocuments {
  source: FiloDocumentJson<SourceTranscriptMetadata>;
  lesson: FiloDocumentJson<LessonTapeMetadata>;
}

export type LessonSegmentAnnotation = FiloAnnotation<LessonSegmentPayload>;
