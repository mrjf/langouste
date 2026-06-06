import { describe, expect, test } from "bun:test";
import { FiloDocument } from "../../src";

describe("FiloDocument", () => {
  test("stores independent tiers over the same byte range", () => {
    const document = FiloDocument.fromText("hello world", {
      id: "doc-1",
      metadata: { language: "en" },
    });
    document.defineTier<{ surface: string }>({ id: "word", kind: "word" });
    document.defineTier<{ text: string; language: string }>({
      id: "translation:fr",
      kind: "translation",
    });

    const hello = document.addAnnotation("word", {
      start: 0,
      end: 5,
      payload: { surface: "hello" },
    });
    const translation = document.addAnnotation("translation:fr", {
      start: 0,
      end: 5,
      payload: { text: "bonjour", language: "fr" },
    });

    expect(document.textOf(hello)).toBe("hello");
    expect(document.annotationsAt(1).map((annotation) => annotation.id)).toEqual([
      hello.id,
      translation.id,
    ]);
  });

  test("queries overlapping, contained, and exact range annotations", () => {
    const document = FiloDocument.fromText("one two three");
    document.defineTier({ id: "phrase", kind: "phrase" });
    const phrase = document.addAnnotation("phrase", {
      start: 0,
      end: 7,
      payload: { phraseType: "chunk" },
    });
    const larger = document.addAnnotation("phrase", {
      start: 0,
      end: document.byteLength,
      payload: { phraseType: "sentence" },
    });

    expect(document.annotationsOverlapping({ start: 4, end: 13 })).toEqual([phrase, larger]);
    expect(document.annotationsWithin({ start: 0, end: 7 })).toEqual([phrase]);
    expect(document.annotationsAtRange({ start: 0, end: 7 })).toEqual([phrase]);
    expect(document.annotationsAt(8)).toEqual([larger]);
  });

  test("serializes and restores document tiers", () => {
    const document = FiloDocument.fromText("Szia világ", {
      id: "doc-2",
      metadata: { language: "hu" },
    });
    document.defineTier({ id: "word", kind: "word" });
    document.addAnnotation("word", {
      start: 0,
      end: 4,
      payload: { surface: "Szia" },
    });

    const restored = FiloDocument.fromJSON(document.toJSON());
    const restoredWord = restored.requireTier("word").annotations[0];
    if (!restoredWord) throw new Error("restored word not found");

    expect(restored.id).toBe("doc-2");
    expect(restored.metadata).toEqual({ language: "hu" });
    expect(restored.textOf(restoredWord)).toBe("Szia");
  });

  test("rejects invalid annotations before tier mutation", () => {
    const document = FiloDocument.fromText("é");
    document.defineTier({ id: "word", kind: "word" });

    expect(() =>
      document.addAnnotation("word", {
        start: 0,
        end: 1,
        payload: { surface: "broken" },
      }),
    ).toThrow("align to UTF-8 boundaries");
    expect(document.requireTier("word").annotations).toEqual([]);
  });
});
