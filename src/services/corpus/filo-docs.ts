import {
  FiloDocument,
  annotateAudio,
  annotateDictionaryLookups,
  annotateSentences,
  annotateTranslation,
  annotateWords,
  type AudioPayload,
  type DictionaryLookupPayload,
  type FiloAnnotation,
  type FiloDocumentJson,
  type SentencePayload,
} from "filo";
import type { Database } from "../../lib/db/index.ts";
import type { Message } from "../../types/index.ts";
import { annotateFullRangeIpaLayers } from "./ipa-layers.ts";
import { normalizeVocabularyTerm } from "../spaced-repetition/vocabulary-normalizer.ts";

export interface MessageFiloInput {
  messageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  language: string | null;
  translations?: Record<string, string>;
  isAgent?: boolean;
  createdAt?: string;
}

export interface MessageAudioTierInput {
  language: string | null;
  audioId?: string;
  url?: string;
  mimeType: string;
  byteLength: number;
  source: string;
  textHash?: string;
  contentHash?: string;
}

export interface MessageAudioReference {
  audioId: string;
  language: string;
  mimeType: string | null;
  byteLength: number | null;
  source: string | null;
}

export function buildBaseMessageFiloDocument(input: MessageFiloInput): FiloDocumentJson {
  const language = input.language ?? "und";
  const document = FiloDocument.fromText(input.text, {
    id: `message:${input.messageId}`,
    metadata: {
      corpus: "messages",
      messageId: input.messageId,
      conversationId: input.conversationId,
      senderId: input.senderId,
      language,
      isAgent: input.isAgent ?? false,
      createdAt: input.createdAt ?? null,
    },
  });

  annotateWords(document, { language, source: "langouste.corpus" });
  annotateSentences(document, { language, source: "langouste.corpus" });
  annotateMessageTranslations(document, input);
  return document.toJSON();
}

export async function buildMessageFiloDocument(input: MessageFiloInput): Promise<FiloDocumentJson> {
  const document = FiloDocument.fromJSON(buildBaseMessageFiloDocument(input));
  await annotateMessageIpa(document, input);
  await annotateMessageDictionary(document, input.language ?? "und");
  annotateLiteralSentenceTranslations(document, input.language ?? "und");
  return document.toJSON();
}

export async function persistBaseMessageFiloDoc(
  db: Database,
  message: Message,
): Promise<FiloDocumentJson> {
  const filoDoc = buildBaseMessageFiloDocument(messageToFiloInput(message));
  await db.update("messages", { filo_doc: filoDoc }, [
    { op: "eq", column: "message_id", value: message.message_id },
  ]);
  message.filo_doc = filoDoc;
  return filoDoc;
}

export async function enrichAndPersistMessageFiloDoc(
  db: Database,
  message: Message,
): Promise<FiloDocumentJson> {
  const filoDoc = await buildMessageFiloDocument(messageToFiloInput(message));
  await db.update("messages", { filo_doc: filoDoc }, [
    { op: "eq", column: "message_id", value: message.message_id },
  ]);
  message.filo_doc = filoDoc;
  return filoDoc;
}

export async function enrichAndPersistMessageIpaLayers(
  db: Database,
  message: Message,
): Promise<FiloDocumentJson> {
  const document = FiloDocument.fromJSON(
    message.filo_doc ?? buildBaseMessageFiloDocument(messageToFiloInput(message)),
  );
  await annotateMessageIpa(document, messageToFiloInput(message));
  const filoDoc = document.toJSON();
  await db.update("messages", { filo_doc: filoDoc }, [
    { op: "eq", column: "message_id", value: message.message_id },
  ]);
  message.filo_doc = filoDoc;
  return filoDoc;
}

export async function appendMessageAudioTier(
  db: Database,
  message: Message,
  input: MessageAudioTierInput,
): Promise<FiloDocumentJson> {
  const document = FiloDocument.fromJSON(
    message.filo_doc ?? buildBaseMessageFiloDocument(messageToFiloInput(message)),
  );
  const language = input.language ?? message.language ?? "und";
  const tierId = `audio:${language}`;
  const existing = document.tier<AudioPayload>(tierId)?.annotations.find((annotation) => {
    const payload = annotation.payload as AudioPayload & Record<string, unknown>;
    return (
      (input.audioId && payload.audioId === input.audioId) ||
      (!!input.url && payload.url === input.url && payload.source === input.source)
    );
  });

  if (!existing) {
    annotateAudio(document, {
      start: 0,
      end: document.byteLength,
      tierId,
      url: input.url ?? `audio:${input.audioId}`,
      mimeType: input.mimeType,
      source: input.source,
      payload: {
        ...(input.audioId ? { audioId: input.audioId } : {}),
        language,
        byteLength: input.byteLength,
        ...(input.textHash ? { textHash: input.textHash } : {}),
        ...(input.contentHash ? { contentHash: input.contentHash } : {}),
        generatedAt: new Date().toISOString(),
      },
    });
  }

  const filoDoc = document.toJSON();
  await db.update("messages", { filo_doc: filoDoc }, [
    { op: "eq", column: "message_id", value: message.message_id },
  ]);
  message.filo_doc = filoDoc;
  return filoDoc;
}

export function findMessageAudioReferences(
  message: Message,
  language: string | null | undefined,
): MessageAudioReference[] {
  if (!message.filo_doc) return [];
  const targetLanguage = language ?? message.language ?? "und";
  const document = FiloDocument.fromJSON(message.filo_doc);
  const tier = document.tier<AudioPayload>(`audio:${targetLanguage}`);
  return (tier?.annotations ?? [])
    .map((annotation) => {
      const payload = annotation.payload as AudioPayload & Record<string, unknown>;
      const audioId = typeof payload.audioId === "string" ? payload.audioId : "";
      if (!audioId) return null;
      return {
        audioId,
        language: targetLanguage,
        mimeType: typeof payload.mimeType === "string" ? payload.mimeType : null,
        byteLength: typeof payload.byteLength === "number" ? payload.byteLength : null,
        source: typeof payload.source === "string" ? payload.source : null,
      };
    })
    .filter((reference): reference is MessageAudioReference => reference !== null);
}

export function messageToFiloInput(message: Message): MessageFiloInput {
  return {
    messageId: message.message_id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    text: message.healed_text || message.raw_text,
    language: message.language,
    translations: message.translations ?? {},
    isAgent: message.is_agent,
    createdAt: message.created_at,
  };
}

function annotateMessageTranslations(document: FiloDocument, input: MessageFiloInput): void {
  if (document.byteLength === 0) return;
  const sourceLanguage = input.language ?? "und";
  for (const [language, text] of Object.entries(input.translations ?? {})) {
    if (!language || language === sourceLanguage || !text.trim()) continue;
    annotateTranslation(document, {
      start: 0,
      end: document.byteLength,
      language,
      sourceLanguage,
      text,
      source: "messages.translations",
    });
  }
}

async function annotateMessageIpa(document: FiloDocument, input: MessageFiloInput): Promise<void> {
  const sourceLanguage = input.language ?? "und";
  await annotateFullRangeIpaLayers(document, [
    {
      language: sourceLanguage,
      text: document.text,
      sourceLanguage,
      source: "messages.text",
    },
    ...Object.entries(input.translations ?? {}).map(([language, text]) => ({
      language,
      text,
      sourceLanguage,
      source: "messages.translations",
    })),
  ]);
}

async function annotateMessageDictionary(document: FiloDocument, language: string): Promise<void> {
  if (language === "und") return;
  await annotateDictionaryLookups(document, {
    language,
    includeMisses: true,
    source: "langouste.vocabulary-normalizer",
    lookup: async ({ surface }) => {
      const normalized = await normalizeVocabularyTerm(surface, language);
      const definitions = normalized.definition ? [normalized.definition] : [];
      return {
        lemma: normalized.term || surface,
        definitions,
        source: normalized.source_term ? "wiktionary" : "langouste-normalizer",
        sourceTerm: normalized.source_term,
        formDescription: normalized.form_description,
      };
    },
  });
}

function annotateLiteralSentenceTranslations(document: FiloDocument, language: string): void {
  if (language === "und") return;
  const sentenceTier = document.tier<SentencePayload>("sentence");
  const dictionaryTier = document.tier<DictionaryLookupPayload>("dictionary");
  if (!sentenceTier || !dictionaryTier) return;

  for (const sentence of sentenceTier.annotations) {
    const glosses = dictionaryTier.annotations
      .filter((entry) => sentence.start <= entry.start && entry.end <= sentence.end)
      .map((entry) => dictionaryGloss(entry))
      .filter((gloss) => gloss.gloss);
    if (glosses.length === 0) continue;
    annotateTranslation(document, {
      start: sentence.start,
      end: sentence.end,
      language: "en",
      sourceLanguage: language,
      tierId: "sentence.translation:en:literal",
      text: glosses.map((gloss) => `${gloss.surface} = ${gloss.gloss}`).join(" · "),
      source: "langouste.dictionary-gloss",
      payload: {
        level: "sentence",
        mode: "literal",
        glosses,
      },
    });
  }
}

function dictionaryGloss(annotation: FiloAnnotation<DictionaryLookupPayload>): {
  surface: string;
  lemma: string | null;
  gloss: string;
} {
  const payload = annotation.payload;
  return {
    surface: payload.surface,
    lemma: payload.lemma ?? null,
    gloss: payload.definitions[0] ?? payload.lemma ?? payload.surface,
  };
}
