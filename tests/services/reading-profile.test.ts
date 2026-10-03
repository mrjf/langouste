import { describe, expect, test } from "bun:test";
import type { FiloDocumentJson } from "filo";
import { createMemoryDatabaseSet } from "../../src/lib/db/memory.ts";
import {
  recordReadingProfileInteraction,
  saveReadingEdition,
} from "../../src/services/reading/profile.ts";

describe("shared reading profile persistence", () => {
  test("stores the Filo edition under its learner and records idempotent vocabulary events", async () => {
    const db = createMemoryDatabaseSet().admin;
    const userId = "reader-1";
    const persistence = await saveReadingEdition(db, userId, readingDocument(), {
      surface: "langouste-news",
      sourceId: "hacker-news:42",
      sourceUrl: "https://example.com/story",
      title: "A shared reader",
    });

    expect(persistence.documentId).toStartWith("reading_");
    const corpus = await db.selectOne<Record<string, unknown>>("corpus_documents", {
      filters: [
        { op: "eq", column: "owner_id", value: userId },
        { op: "eq", column: "document_id", value: persistence.documentId },
      ],
    });
    expect(corpus).toMatchObject({
      owner_id: userId,
      source_type: "reading",
      source_id: "hacker-news:42",
      title: "A shared reader",
    });

    const interaction = {
      documentId: persistence.documentId,
      eventType: "sentence_inspected" as const,
      language: "fr",
      sentenceOrdinal: 0,
    };
    const first = await recordReadingProfileInteraction(db, userId, interaction);
    const duplicate = await recordReadingProfileInteraction(db, userId, interaction);

    expect(first).toMatchObject({ created: true, vocabularyEvents: 1 });
    expect(duplicate).toEqual({
      interactionId: first.interactionId,
      created: false,
      vocabularyEvents: 0,
    });
    expect(await db.select("reading_interactions")).toHaveLength(1);
    expect(await db.selectOne("reading_interactions")).toMatchObject({
      user_id: userId,
      document_id: persistence.documentId,
      source_type: "langouste-news",
      source_url: "https://example.com/story",
      title: "A shared reader",
      language: "fr",
      event_type: "sentence_inspected",
      text: "Bonjour le monde.",
      source_text: "Hello world.",
    });
    expect(
      await db.selectOne("vocabulary", {
        filters: [
          { op: "eq", column: "user_id", value: userId },
          { op: "eq", column: "language", value: "fr" },
          { op: "eq", column: "term", value: "bonjour" },
        ],
      }),
    ).toMatchObject({
      translation: "hello",
      context_sentence: "Bonjour le monde.",
      encounters: 1,
      heard: 0,
    });
    expect(
      await db.selectOne("review_log", {
        filters: [{ op: "eq", column: "source", value: "reading_sentence" }],
      }),
    ).toMatchObject({ event_type: "encounter", language: "fr" });
  });

  test("uses the shared heard counter when a saved sentence is played", async () => {
    const db = createMemoryDatabaseSet().admin;
    const persistence = await saveReadingEdition(db, "reader-2", readingDocument(), {
      surface: "langouste-news",
    });

    const result = await recordReadingProfileInteraction(db, "reader-2", {
      documentId: persistence.documentId,
      eventType: "audio_played",
      language: "fr",
      sentenceOrdinal: 0,
    });

    expect(result).toMatchObject({ created: true, vocabularyEvents: 1 });
    expect(
      await db.selectOne("vocabulary", {
        filters: [{ op: "eq", column: "user_id", value: "reader-2" }],
      }),
    ).toMatchObject({ encounters: 0, heard: 1 });
    expect(
      await db.selectOne("review_log", {
        filters: [{ op: "eq", column: "source", value: "reading_audio" }],
      }),
    ).toMatchObject({ event_type: "heard", language: "fr" });
  });
});

function readingDocument(): FiloDocumentJson {
  const source = "Hello world.";
  return {
    id: "hacker-news:42",
    text: source,
    byteLength: new TextEncoder().encode(source).byteLength,
    metadata: {
      corpus: "langouste-news",
      source: "hacker-news",
      sourceLanguage: "en",
      sourceUrl: "https://example.com/story",
      title: "A shared reader",
      languages: ["fr"],
      level: "B1",
      model: "test-model",
    },
    tiers: [
      tier("sentence", "sentence", [{ text: source, ordinal: 0, language: "en" }]),
      tier("sentence.translation:fr", "translation", [
        {
          text: "Bonjour le monde.",
          language: "fr",
          sourceLanguage: "en",
          ordinal: 0,
        },
      ]),
      tier("sentence.word-alignment:fr", "parse", [
        {
          language: "fr",
          ordinal: 0,
          tokens: [
            { text: "Bonjour", leading: "", sourceWordOrdinals: [0], wordLike: true, ordinal: 0 },
            { text: "le", leading: " ", sourceWordOrdinals: [1], wordLike: true, ordinal: 1 },
            { text: "monde", leading: " ", sourceWordOrdinals: [1], wordLike: true, ordinal: 2 },
            { text: ".", leading: "", sourceWordOrdinals: [], wordLike: false, ordinal: 3 },
          ],
        },
      ]),
      tier("sentence.vocabulary:fr", "dictionary.lookup", [
        {
          language: "fr",
          ordinal: 0,
          term: "bonjour",
          meaning: "hello",
          partOfSpeech: "interjection",
        },
      ]),
    ],
  };
}

function tier(id: string, kind: string, payloads: Array<Record<string, unknown>>) {
  return {
    id,
    kind,
    annotations: payloads.map((payload, index) => ({
      id: `${id}:${index}`,
      tierId: id,
      kind,
      start: 0,
      end: 12,
      payload,
      source: "test",
    })),
  };
}
