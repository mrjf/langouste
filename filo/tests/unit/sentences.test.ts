import { describe, expect, test } from "bun:test";
import { FiloDocument, annotateSentences } from "../../src";

describe("annotateSentences", () => {
  test("creates sentence annotations with UTF-8 byte ranges", () => {
    const document = FiloDocument.fromText("Szia világ! Árvíztűrő tükörfúrógép.\n\nNo terminator");
    const sentences = annotateSentences(document, { language: "hu" });

    expect(sentences.map((sentence) => document.textOf(sentence))).toEqual([
      "Szia világ!",
      "Árvíztűrő tükörfúrógép.",
      "No terminator",
    ]);
    expect(sentences.map((sentence) => sentence.payload.ordinal)).toEqual([0, 1, 2]);
    const accentedSentence = sentences[1];
    if (!accentedSentence) throw new Error("accented sentence not annotated");
    expect(accentedSentence.end - accentedSentence.start).toBe(
      Buffer.byteLength("Árvíztűrő tükörfúrógép.", "utf8"),
    );
  });
});
