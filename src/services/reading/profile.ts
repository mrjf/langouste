import { createHash } from "node:crypto";
import type { FiloAnnotation, FiloDocumentJson, FiloTierJson } from "filo";
import { ensureLocalSession } from "../../lib/auth/local.ts";
import { config } from "../../lib/config.ts";
import { adminDb, type Database } from "../../lib/db/index.ts";
import { findOwnedCorpusDocument, indexFiloDocument } from "../corpus/store.ts";
import {
  createReadingInteraction,
  findReadingInteraction,
  type ReadingInteractionEvent,
  type ReadingInteractionVocabulary,
} from "../database/reading-interactions.ts";
import { recordInteraction, type InteractionSource } from "../spaced-repetition/interactions.ts";
import { normalizeVocabularyTerm } from "../spaced-repetition/vocabulary-normalizer.ts";

export interface ReadingEditionContext {
  /** Stable product surface identifier, for example `langouste-news`. */
  surface: string;
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
}

export interface ReadingEditionPersistence {
  documentId: string;
  storedAt: string;
}

export interface ReadingProfileInteractionInput {
  documentId: string;
  eventType: ReadingInteractionEvent;
  language?: string;
  sentenceOrdinal?: number;
  tokenOrdinal?: number;
  vocabularyOrdinal?: number;
}

export interface ReadingProfileInteractionResult {
  interactionId: string;
  created: boolean;
  vocabularyEvents: number;
}

export interface ReadingProfileStore {
  readonly destination: string;
  saveEdition(
    document: FiloDocumentJson,
    context: ReadingEditionContext,
  ): Promise<ReadingEditionPersistence>;
  recordInteraction(
    input: ReadingProfileInteractionInput,
  ): Promise<ReadingProfileInteractionResult>;
}

interface InteractionDetails {
  language: string | null;
  sentenceOrdinal: number | null;
  tokenOrdinal: number | null;
  vocabularyOrdinal: number | null;
  text: string;
  sourceText: string;
  vocabulary: ReadingInteractionVocabulary[];
}

const EVENT_TYPES = new Set<ReadingInteractionEvent>([
  "article_opened",
  "sentence_hovered",
  "sentence_inspected",
  "word_hovered",
  "vocabulary_inspected",
  "audio_played",
  "workbench_opened",
]);
const interactionTails = new Map<string, Promise<void>>();

/**
 * Persist a complete reading surface in the learner-owned Filo corpus. The
 * caller keeps its original document ID; Langouste derives an edition ID so
 * different language/level variants of the same article remain distinct.
 */
export async function saveReadingEdition(
  db: Database,
  userId: string,
  document: FiloDocumentJson,
  context: ReadingEditionContext,
): Promise<ReadingEditionPersistence> {
  if (!userId.trim()) throw new Error("userId is required");
  if (!context.surface.trim()) throw new Error("reading surface is required");
  if (!document.id || !document.text.trim())
    throw new Error("A non-empty Filo document is required");

  const sourceId = context.sourceId?.trim() || document.id;
  const documentId = readingEditionId(document, context.surface);
  const storedDocument = structuredClone(document);
  storedDocument.id = documentId;
  storedDocument.metadata = {
    ...storedDocument.metadata,
    sourceDocumentId: document.id,
    profileSurface: context.surface,
    ...(context.sourceUrl?.trim() ? { sourceUrl: context.sourceUrl.trim() } : {}),
    ...(context.title?.trim() ? { title: context.title.trim() } : {}),
  };
  const row = await indexFiloDocument(db, storedDocument, {
    ownerId: userId,
    sourceType: "reading",
    sourceId,
    language: null,
    title: context.title?.trim() || stringValue(document.metadata.title),
  });
  return { documentId: row.document_id, storedAt: row.updated_at };
}

/**
 * Resolve an interaction from the stored Filo tiers, append an idempotent
 * reading event, and feed vocabulary encounters/heard events through the same
 * learner-profile write boundary used by chat, Workbench, and review.
 */
export async function recordReadingProfileInteraction(
  db: Database,
  userId: string,
  input: ReadingProfileInteractionInput,
): Promise<ReadingProfileInteractionResult> {
  validateInteractionInput(input);
  const corpus = await findOwnedCorpusDocument(db, userId, input.documentId, "reading");
  if (!corpus) throw new Error("Reading edition not found for this Langouste profile");
  const details = interactionDetails(corpus.filo_doc, input);
  const interactionId = readingInteractionId(userId, input, details);

  return serialized(interactionId, async () => {
    const existing = await findReadingInteraction(db, interactionId);
    if (existing) {
      return { interactionId, created: false, vocabularyEvents: 0 };
    }

    const vocabularyEvents = await recordVocabularyEvents(db, userId, input.eventType, details);
    const metadata = corpus.filo_doc.metadata as Record<string, unknown>;
    await createReadingInteraction(db, {
      interaction_id: interactionId,
      user_id: userId,
      document_id: corpus.document_id,
      source_type: stringValue(metadata.profileSurface) ?? "reading",
      source_id: corpus.source_id ?? stringValue(metadata.sourceDocumentId) ?? corpus.document_id,
      source_url: stringValue(metadata.sourceUrl) ?? "",
      title: corpus.title ?? stringValue(metadata.title) ?? "Untitled reading",
      language: details.language,
      event_type: input.eventType,
      sentence_ordinal: details.sentenceOrdinal,
      token_ordinal: details.tokenOrdinal,
      vocabulary_ordinal: details.vocabularyOrdinal,
      text: details.text,
      source_text: details.sourceText,
      vocabulary: details.vocabulary,
      metadata: {
        level: stringValue(metadata.level),
        model: stringValue(metadata.model),
        corpus: stringValue(metadata.corpus),
      },
    });
    return { interactionId, created: true, vocabularyEvents };
  });
}

/**
 * Default integration for sibling apps running beside Langouste in its
 * single-user mode. Multi-user deployments must supply an authenticated store
 * with an explicit user ID instead of silently selecting an account.
 */
export function createLocalReadingProfileStore(): ReadingProfileStore {
  let userIdPromise: Promise<string> | null = null;
  const userId = async () => {
    if (!config.singleUser) {
      throw new Error(
        "Langouste reading integration requires an authenticated profile when single-user mode is disabled",
      );
    }
    userIdPromise ??= ensureLocalSession().then((session) => session.user.id);
    return userIdPromise;
  };
  return {
    destination: "Langouste profile",
    async saveEdition(document, context) {
      return saveReadingEdition(adminDb(), await userId(), document, context);
    },
    async recordInteraction(input) {
      return recordReadingProfileInteraction(adminDb(), await userId(), input);
    },
  };
}

export function readingEditionId(document: FiloDocumentJson, surface: string): string {
  const metadata = document.metadata as Record<string, unknown>;
  const identity = [
    "v1",
    surface.trim(),
    document.id,
    document.text,
    stableJson(metadata.languages ?? []),
    stringValue(metadata.level) ?? "",
    stringValue(metadata.model) ?? "",
  ].join("\0");
  return `reading_${createHash("sha256").update(identity).digest("hex")}`;
}

function validateInteractionInput(input: ReadingProfileInteractionInput): void {
  if (!input.documentId?.trim()) throw new Error("documentId is required");
  if (!EVENT_TYPES.has(input.eventType)) throw new Error("Unknown reading interaction type");
  if (input.eventType === "article_opened") return;
  if (!input.language?.trim()) throw new Error("language is required for a text interaction");
  if (!Number.isInteger(input.sentenceOrdinal) || (input.sentenceOrdinal ?? -1) < 0) {
    throw new Error("sentenceOrdinal must be a non-negative integer");
  }
  if (input.eventType === "word_hovered") {
    if (!Number.isInteger(input.tokenOrdinal) || (input.tokenOrdinal ?? -1) < 0) {
      throw new Error("tokenOrdinal must be a non-negative integer for a word interaction");
    }
  }
  if (input.eventType === "vocabulary_inspected") {
    if (!Number.isInteger(input.vocabularyOrdinal) || (input.vocabularyOrdinal ?? -1) < 0) {
      throw new Error(
        "vocabularyOrdinal must be a non-negative integer for a vocabulary interaction",
      );
    }
  }
}

function interactionDetails(
  document: FiloDocumentJson,
  input: ReadingProfileInteractionInput,
): InteractionDetails {
  if (input.eventType === "article_opened") {
    return {
      language: null,
      sentenceOrdinal: null,
      tokenOrdinal: null,
      vocabularyOrdinal: null,
      text: stringValue(document.metadata.title) ?? document.text.slice(0, 500),
      sourceText: "",
      vocabulary: [],
    };
  }

  const language = input.language!.trim();
  const configuredLanguages = Array.isArray(document.metadata.languages)
    ? document.metadata.languages.filter((value): value is string => typeof value === "string")
    : [];
  if (configuredLanguages.length && !configuredLanguages.includes(language)) {
    throw new Error(`Language ${language} is not present in this reading edition`);
  }
  const sentence = sentenceForOrdinal(document, input.sentenceOrdinal!);
  const sourcePayload = sentence.payload as Record<string, unknown>;
  const sourceText =
    stringValue(sourcePayload.text) ??
    textForByteRange(document.text, sentence.start, sentence.end);
  const translated = exactAt(tier(document, `sentence.translation:${language}`), sentence)[0]
    ?.payload as Record<string, unknown> | undefined;
  const sentenceText = stringValue(translated?.text);
  if (!sentenceText) throw new Error("Translated sentence not found in the reading edition");
  const vocabulary = exactAt(tier(document, `sentence.vocabulary:${language}`), sentence).flatMap(
    (annotation) =>
      vocabularyFromPayload(
        annotation.payload as Record<string, unknown>,
        sentenceText,
        stringValue(document.metadata.level) ?? undefined,
      ),
  );

  if (input.eventType === "word_hovered") {
    const alignment = exactAt(tier(document, `sentence.word-alignment:${language}`), sentence)[0]
      ?.payload as Record<string, unknown> | undefined;
    const tokens = Array.isArray(alignment?.tokens) ? alignment.tokens : [];
    const token = tokens.find(
      (candidate) => isRecord(candidate) && candidate.ordinal === input.tokenOrdinal,
    ) as Record<string, unknown> | undefined;
    const text = stringValue(token?.text);
    if (!text) throw new Error("Aligned word not found in the reading edition");
    const matching = vocabulary.filter(
      (item) => normalizeForMatch(item.term) === normalizeForMatch(text),
    );
    return {
      language,
      sentenceOrdinal: input.sentenceOrdinal!,
      tokenOrdinal: input.tokenOrdinal!,
      vocabularyOrdinal: null,
      text,
      sourceText,
      vocabulary: matching.length
        ? matching
        : [{ term: text, translation: "", contextSentence: sentenceText }],
    };
  }

  if (input.eventType === "vocabulary_inspected") {
    const selected = vocabulary[input.vocabularyOrdinal!];
    if (!selected) throw new Error("Vocabulary item not found in the reading edition");
    return {
      language,
      sentenceOrdinal: input.sentenceOrdinal!,
      tokenOrdinal: null,
      vocabularyOrdinal: input.vocabularyOrdinal!,
      text: selected.term,
      sourceText,
      vocabulary: [selected],
    };
  }

  return {
    language,
    sentenceOrdinal: input.sentenceOrdinal!,
    tokenOrdinal: null,
    vocabularyOrdinal: null,
    text: sentenceText,
    sourceText,
    vocabulary,
  };
}

async function recordVocabularyEvents(
  db: Database,
  userId: string,
  eventType: ReadingInteractionEvent,
  details: InteractionDetails,
): Promise<number> {
  if (!details.language || details.vocabulary.length === 0 || eventType === "article_opened") {
    return 0;
  }
  const event = eventType === "audio_played" ? "heard" : "encounter";
  const source = interactionSource(eventType);
  const unique = new Map<string, ReadingInteractionVocabulary>();
  for (const item of details.vocabulary) {
    const normalized = await normalizeVocabularyTerm(item.term, details.language);
    if (!normalized.term || unique.has(normalized.term)) continue;
    unique.set(normalized.term, { ...item, term: normalized.term });
  }
  for (const item of unique.values()) {
    await recordInteraction(db, {
      userId,
      language: details.language,
      itemType: "vocabulary",
      lookupKey: item.term,
      seed: {
        translation: item.translation,
        context_sentence: item.contextSentence,
        cefr_level: item.cefrLevel,
      },
      eventType: event,
      source,
    });
  }
  return unique.size;
}

function interactionSource(eventType: ReadingInteractionEvent): InteractionSource {
  switch (eventType) {
    case "word_hovered":
      return "reading_word";
    case "vocabulary_inspected":
      return "reading_vocabulary";
    case "audio_played":
      return "reading_audio";
    case "workbench_opened":
      return "reading_workbench";
    case "article_opened":
    case "sentence_hovered":
    case "sentence_inspected":
      return "reading_sentence";
  }
}

function readingInteractionId(
  userId: string,
  input: ReadingProfileInteractionInput,
  details: InteractionDetails,
): string {
  return createHash("sha256")
    .update(
      [
        "v1",
        userId,
        input.documentId,
        input.eventType,
        details.language ?? "",
        details.sentenceOrdinal ?? "",
        details.tokenOrdinal ?? "",
        details.vocabularyOrdinal ?? "",
      ].join("\0"),
    )
    .digest("hex");
}

function sentenceForOrdinal(document: FiloDocumentJson, ordinal: number): FiloAnnotation<unknown> {
  const sentence = (tier(document, "sentence")?.annotations ?? []).find((candidate) => {
    const payload = candidate.payload as Record<string, unknown>;
    return payload.ordinal === ordinal;
  });
  if (!sentence) throw new Error("Sentence not found in the reading edition");
  return sentence;
}

function vocabularyFromPayload(
  payload: Record<string, unknown>,
  contextSentence: string,
  cefrLevel?: string,
): ReadingInteractionVocabulary[] {
  const term = stringValue(payload.term);
  if (!term) return [];
  return [
    {
      term,
      translation: stringValue(payload.meaning) ?? "",
      contextSentence,
      ...(cefrLevel ? { cefrLevel } : {}),
    },
  ];
}

function tier(document: FiloDocumentJson, id: string): FiloTierJson | undefined {
  return document.tiers.find((candidate) => candidate.id === id);
}

function exactAt(
  candidate: FiloTierJson | undefined,
  range: { start: number; end: number },
): Array<FiloAnnotation<unknown>> {
  return (candidate?.annotations ?? []).filter(
    (annotation) => annotation.start === range.start && annotation.end === range.end,
  );
}

function textForByteRange(text: string, start: number, end: number): string {
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(start, end));
}

function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = interactionTails.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  interactionTails.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (interactionTails.get(key) === current) interactionTails.delete(key);
  }
}
