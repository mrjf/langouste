import { describe, expect, test } from "bun:test";
import {
  FiloDocument,
  annotateAudio,
  annotateDictionaryLookups,
  annotateTranslation,
  annotateWords,
  type DictionaryLookupPayload,
  type DictionaryLookupResult,
} from "../../src";

const hungarianText = "Számos README található szétszórva ebben a könyvtárban.";

describe("annotation flow", () => {
  test("layers words, dictionary lookups, phrase translations, and audio links", async () => {
    const document = FiloDocument.fromText(hungarianText, {
      id: "message-1",
      metadata: {
        language: "hu",
        source: "chat-message",
      },
    });

    const words = annotateWords(document, { language: "hu" });
    await annotateDictionaryLookups(document, {
      language: "hu",
      lookup: fakeHungarianLookup,
      includeMisses: true,
    });

    const phraseStart = words.find((word) => word.payload.surface === "szétszórva")?.start;
    const phraseEnd = words.find((word) => word.payload.surface === "könyvtárban")?.end;
    if (phraseStart === undefined || phraseEnd === undefined) {
      throw new Error("test fixture words not found");
    }

    annotateTranslation(document, {
      start: phraseStart,
      end: phraseEnd,
      language: "en",
      sourceLanguage: "hu",
      text: "scattered throughout this directory",
      source: "wiktionary-gloss",
    });

    annotateAudio(document, {
      start: 0,
      end: document.byteLength,
      url: "https://media.example.test/message-1.mp3",
      mimeType: "audio/mpeg",
      startMs: 0,
      endMs: 4200,
      source: "tts",
    });

    const targetWord = words.find((word) => word.payload.surface === "szétszórva");
    if (!targetWord) throw new Error("szétszórva not found");
    const hoveredByteOffset = targetWord.start + 2;
    const annotations = document.annotationsAt(hoveredByteOffset);

    expect(annotations.map((annotation) => annotation.tierId)).toEqual([
      "word",
      "dictionary",
      "translation:en",
      "audio",
    ]);
    expect(document.textOf(targetWord)).toBe("szétszórva");
    expect(dictionaryPayloadFor(annotations, "szétszórva")).toEqual({
      surface: "szétszórva",
      lemma: "szétszór",
      language: "hu",
      definitions: ["scattered, around"],
      partOfSpeech: "adverbial participle",
      source: "test-dictionary",
      wordAnnotationId: targetWord.id,
      notFound: false,
    });

    const translation = annotations.find((annotation) => annotation.kind === "translation");
    expect(translation?.payload).toMatchObject({
      language: "en",
      text: "scattered throughout this directory",
    });
  });

  test("round-trips a full annotation graph without losing byte anchors", async () => {
    const document = FiloDocument.fromText(hungarianText, { id: "message-2" });
    annotateWords(document, { language: "hu" });
    await annotateDictionaryLookups(document, {
      language: "hu",
      lookup: fakeHungarianLookup,
      includeMisses: true,
    });

    const restored = FiloDocument.fromJSON(document.toJSON());
    const ebben = restored
      .requireTier("word")
      .annotations.find((annotation) => annotation.payload.surface === "ebben");
    if (!ebben) throw new Error("ebben not found");

    const annotations = restored.annotationsAt(ebben.start);

    expect(restored.textOf(ebben)).toBe("ebben");
    expect(dictionaryPayloadFor(annotations, "ebben")).toMatchObject({
      lemma: "ez",
      definitions: ["in this"],
    });
  });

  test("supports overlapping phrase tiers without imposing a tree", async () => {
    const document = FiloDocument.fromText("The quick brown fox");
    const words = annotateWords(document, { language: "en" });
    const quick = words.find((word) => word.payload.surface === "quick");
    const brown = words.find((word) => word.payload.surface === "brown");
    const fox = words.find((word) => word.payload.surface === "fox");
    if (!quick || !brown || !fox) throw new Error("fixture word missing");

    document.ensureTier({ id: "phrase", kind: "phrase" });
    const adjectivePhrase = document.addAnnotation("phrase", {
      start: quick.start,
      end: brown.end,
      payload: { phraseType: "adjective-phrase" },
    });
    const nounPhrase = document.addAnnotation("phrase", {
      start: brown.start,
      end: fox.end,
      payload: { phraseType: "noun-phrase" },
    });

    expect(document.annotationsOverlapping(brown, { tierIds: ["phrase"] })).toEqual([
      adjectivePhrase,
      nounPhrase,
    ]);
  });
});

async function fakeHungarianLookup({
  surface,
}: {
  surface: string;
}): Promise<DictionaryLookupResult | null> {
  const entries: Record<string, DictionaryLookupResult> = {
    Számos: {
      lemma: "számos",
      definitions: ["numerous, many"],
      partOfSpeech: "adjective",
      source: "test-dictionary",
    },
    található: {
      lemma: "található",
      definitions: ["can be found"],
      partOfSpeech: "adjective",
      source: "test-dictionary",
    },
    szétszórva: {
      lemma: "szétszór",
      definitions: ["scattered, around"],
      partOfSpeech: "adverbial participle",
      source: "test-dictionary",
    },
    ebben: {
      lemma: "ez",
      definitions: ["in this"],
      partOfSpeech: "pronoun",
      source: "test-dictionary",
    },
    könyvtárban: {
      lemma: "könyvtár",
      definitions: ["in the directory"],
      partOfSpeech: "noun",
      source: "test-dictionary",
    },
  };
  return entries[surface] ?? null;
}

function dictionaryPayloadFor(
  annotations: Array<{ kind: string; payload: unknown }>,
  surface: string,
): DictionaryLookupPayload | undefined {
  return annotations.find(
    (annotation) =>
      annotation.kind === "dictionary.lookup" &&
      (annotation.payload as DictionaryLookupPayload).surface === surface,
  )?.payload as DictionaryLookupPayload | undefined;
}
