import { describe, expect, test } from "bun:test";
import { FiloDocument, annotatePhraseBoundaries, annotateWords, type PhrasePayload } from "../../src";

describe("phrase annotation", () => {
  test("creates overlapping noun, verb, and prepositional phrase tiers", () => {
    const document = FiloDocument.fromText("The quick brown fox jumps over the lazy dog");
    annotateWords(document, { language: "en" });

    const phrases = annotatePhraseBoundaries(document, { language: "en" });

    expect(
      phrases.map((phrase) => ({
        type: phrase.payload.phraseType,
        text: document.textOf(phrase),
      })),
    ).toContainEqual({
      type: "noun-phrase",
      text: "The quick brown fox",
    });
    expect(
      phrases.map((phrase) => ({
        type: phrase.payload.phraseType,
        text: document.textOf(phrase),
      })),
    ).toContainEqual({
      type: "prepositional-phrase",
      text: "over the lazy dog",
    });
    expect(
      phrases.map((phrase) => ({
        type: phrase.payload.phraseType,
        text: document.textOf(phrase),
      })),
    ).toContainEqual({
      type: "verb-phrase",
      text: "jumps over the lazy dog",
    });

    const dog = document
      .requireTier("word")
      .annotations.find((annotation) => annotation.payload.surface === "dog");
    if (!dog) throw new Error("fixture word not found");

    expect(
      new Set(
        document
        .annotationsOverlapping(dog, { tierIds: ["phrase"] })
        .map((annotation) => (annotation.payload as PhrasePayload).phraseType),
      ),
    ).toEqual(new Set(["noun-phrase", "prepositional-phrase", "verb-phrase"]));
  });
});
