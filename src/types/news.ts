import type { FiloDocumentJson } from "filo";

export type NewsSourceId = "hacker-news" | "nytimes" | "sfchronicle";

export interface NewsListingItem {
  id: string;
  source: NewsSourceId;
  title: string;
  url: string;
  articleUrl?: string;
  discussionUrl?: string;
  summary?: string;
  section?: string;
  author?: string;
  publishedAt?: string;
  score?: number;
  commentCount?: number;
}

export interface ScrapedArticle {
  id: string;
  source: NewsSourceId;
  title: string;
  url: string;
  paragraphs: string[];
  sourceLanguage: "en";
  byline?: string;
  publishedAt?: string;
  section?: string;
  description?: string;
  discussionUrl?: string;
  extraction?: "article" | "feed-summary";
}

export interface SourceAdapter {
  readonly id: NewsSourceId;
  list(limit?: number): Promise<NewsListingItem[]>;
  scrape(input: string): Promise<ScrapedArticle>;
}

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1";

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
}

export const NEWS_LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "hu", name: "Hungarian", nativeName: "Magyar", direction: "ltr" },
  { code: "ar", name: "Arabic", nativeName: "العربية", direction: "rtl" },
  { code: "fr", name: "French", nativeName: "Français", direction: "ltr" },
  { code: "pt", name: "Portuguese", nativeName: "Português", direction: "ltr" },
  { code: "es", name: "Spanish", nativeName: "Español", direction: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", direction: "ltr" },
  { code: "it", name: "Italian", nativeName: "Italiano", direction: "ltr" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", direction: "ltr" },
  { code: "pl", name: "Polish", nativeName: "Polski", direction: "ltr" },
  { code: "ru", name: "Russian", nativeName: "Русский", direction: "ltr" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", direction: "ltr" },
];

export interface ReadingRequest {
  source: NewsSourceId;
  input: string;
  languages: string[];
  level: CefrLevel;
}

export interface ReadingDocumentMetadata extends Record<string, unknown> {
  corpus: "langouste-news" | "rgt-polyglot-news";
  source: NewsSourceId;
  sourceLanguage: "en";
  sourceUrl: string;
  readingInput?: string;
  discussionUrl?: string;
  title: string;
  byline?: string;
  publishedAt?: string;
  section?: string;
  languages: string[];
  level: CefrLevel;
  generatedAt: string;
  model: string;
  extraction?: "article" | "feed-summary";
}

export interface AlignedToken extends Record<string, unknown> {
  text: string;
  leading: string;
  sourceWordOrdinals: number[];
  wordLike: boolean;
  ordinal: number;
}

export interface TranslationPayload extends Record<string, unknown> {
  language: string;
  text: string;
  sourceLanguage: "en";
  level: CefrLevel;
  ordinal: number;
}

export interface WordAlignmentPayload extends Record<string, unknown> {
  language: string;
  ordinal: number;
  tokens: AlignedToken[];
}

export interface ExplanationPayload extends Record<string, unknown> {
  language: string;
  text: string;
  ordinal: number;
}

export interface GrammarPayload extends Record<string, unknown> {
  language: string;
  label: string;
  explanation: string;
  targetText?: string;
  ordinal: number;
}

export interface VocabularyPayload extends Record<string, unknown> {
  language: string;
  term: string;
  meaning: string;
  partOfSpeech?: string;
  ordinal: number;
}

export interface ProfilePersistence {
  documentId: string;
  storedAt: string;
}

export interface ReadingResponse {
  document: FiloDocumentJson<ReadingDocumentMetadata>;
  cacheHit: boolean;
  persistence: ProfilePersistence;
}

export type ReadingJobStatus = "building" | "ready" | "error";

export interface ReadingJobResponse {
  id: string;
  status: ReadingJobStatus;
  startedAt: string;
  updatedAt: string;
  response?: ReadingResponse;
  error?: string;
}

export interface ReadyReadingSummary {
  key: string;
  articleId: string;
  source: NewsSourceId;
  input: string;
  title: string;
  sourceUrl: string;
  discussionUrl?: string;
  languages: string[];
  level: CefrLevel;
  model: string;
  sentenceCount: number;
  generatedAt: string;
  storedAt: string;
}

export interface ReadyReadingsResponse {
  items: ReadyReadingSummary[];
}

export type ReadingInteractionEvent =
  | "article_opened"
  | "sentence_hovered"
  | "sentence_inspected"
  | "word_hovered"
  | "vocabulary_inspected"
  | "audio_played"
  | "workbench_opened";

export interface ReadingInteractionRequest {
  documentId: string;
  eventType: ReadingInteractionEvent;
  language?: string;
  sentenceOrdinal?: number;
  tokenOrdinal?: number;
  vocabularyOrdinal?: number;
}

export interface ReadingInteractionResponse {
  interactionId: string;
  created: boolean;
  vocabularyEvents: number;
}

export interface SourceListingResponse {
  source: NewsSourceId;
  items: NewsListingItem[];
}
