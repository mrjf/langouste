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
  translation?: string;
  reason?: string;
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
  words: LessonItem[];
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
  durationMs?: number;
  pauseRole?: "padding" | "response";
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
  durationMs?: number;
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
  pauseMs?: number;
  wordPauseMs?: number;
  reviewOffsets?: number[];
}

export interface AudioDrillTapeDocuments {
  source: FiloDocumentJson<SourceTranscriptMetadata>;
  lesson: FiloDocumentJson<LessonTapeMetadata>;
}

export type LessonSegmentAnnotation = FiloAnnotation<LessonSegmentPayload>;
