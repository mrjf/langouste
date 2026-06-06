export type ByteOffset = number;
export type AnnotationId = string;
export type TierId = string;

export type AnnotationKind =
  | "token"
  | "word"
  | "sentence"
  | "phrase"
  | "translation"
  | "dictionary.lookup"
  | "audio"
  | "phonetic"
  | "parse"
  | "grammar"
  | "custom"
  | (string & {});

export type FiloSourceKind =
  | "human"
  | "agent"
  | "translator"
  | "transliterator"
  | "dictionary"
  | "spellcheck"
  | "transcriber"
  | "system"
  | "fallback"
  | "unknown"
  | (string & {});

export interface FiloSource {
  id: string;
  kind: FiloSourceKind;
  label: string;
  module?: string;
  provider?: string;
  version?: string;
  url?: string;
  generatedAt?: string;
  parentSourceIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ByteRange {
  /** Inclusive UTF-8 byte offset. */
  start: ByteOffset;
  /** Exclusive UTF-8 byte offset. */
  end: ByteOffset;
}

export interface FiloAnnotation<Payload = Record<string, unknown>> extends ByteRange {
  id: AnnotationId;
  tierId: TierId;
  kind: AnnotationKind;
  payload: Payload;
  confidence?: number;
  source?: string;
  sourceInfo?: FiloSource;
}

export interface FiloAnnotationInput<Payload = Record<string, unknown>> extends ByteRange {
  id?: AnnotationId;
  kind?: AnnotationKind;
  payload: Payload;
  confidence?: number;
  source?: string;
  sourceInfo?: FiloSource;
}

export interface FiloTierSpec {
  id: TierId;
  kind: AnnotationKind;
  description?: string;
  source?: string;
  sourceInfo?: FiloSource;
  metadata?: Record<string, unknown>;
}

export interface FiloTierJson<Payload = Record<string, unknown>> extends FiloTierSpec {
  source: string;
  annotations: Array<FiloAnnotation<Payload>>;
}

export interface FiloDocumentJson<Metadata = Record<string, unknown>> {
  id: string;
  text: string;
  byteLength: number;
  metadata: Metadata;
  tiers: Array<FiloTierJson>;
}

export interface AnnotationQuery {
  tierIds?: TierId[];
  kinds?: AnnotationKind[];
}

export interface WordPayload {
  surface: string;
  normalized: string;
  ordinal: number;
  language?: string;
}

export interface TokenPayload extends WordPayload {
  tokenType: "word" | "punctuation" | "symbol";
}

export interface DictionaryLookupPayload {
  surface: string;
  lemma?: string;
  language: string;
  definitions: string[];
  partOfSpeech?: string;
  source?: string;
  sourceUrl?: string;
  wordAnnotationId?: AnnotationId;
  notFound?: boolean;
  [key: string]: unknown;
}

export interface TranslationPayload {
  language: string;
  text: string;
  sourceLanguage?: string;
  source?: string;
  [key: string]: unknown;
}

export interface SentencePayload {
  text: string;
  ordinal: number;
  language?: string;
  [key: string]: unknown;
}

export interface AudioPayload {
  url: string;
  mimeType?: string;
  startMs?: number;
  endMs?: number;
  source?: string;
  [key: string]: unknown;
}

export interface PhoneticPayload {
  system: string;
  language: string;
  text: string;
  sourceLanguage?: string;
  sourceText?: string;
  provider?: string;
  [key: string]: unknown;
}

export interface PhrasePayload {
  label?: string;
  phraseType?: string;
  [key: string]: unknown;
}

export type RangeLike = ByteRange | FiloAnnotation<unknown>;
