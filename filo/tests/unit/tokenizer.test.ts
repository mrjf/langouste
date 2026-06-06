import { describe, expect, test } from "bun:test";
import { FiloDocument, annotateTokens, annotateWords } from "../../src";

describe("token annotation", () => {
  test("annotates Unicode word boundaries with byte offsets", () => {
    const document = FiloDocument.fromText("Számos README található.");
    const words = annotateWords(document, { language: "hu" });

    expect(words.map((word) => word.payload.surface)).toEqual([
      "Számos",
      "README",
      "található",
    ]);
    expect(words.map((word) => document.textOf(word))).toEqual([
      "Számos",
      "README",
      "található",
    ]);
    expect(words[0]?.start).toBe(0);
    expect(words[0]?.end).toBe(7);
    expect(words[2]?.start).toBe(15);
    expect(words[2]?.end).toBe(26);
  });

  test("can annotate punctuation tokens separately from words", () => {
    const document = FiloDocument.fromText("Hi, Joe.");
    const tokens = annotateTokens(document, { language: "en" });

    expect(tokens.map((token) => [token.payload.surface, token.payload.tokenType])).toEqual([
      ["Hi", "word"],
      [",", "punctuation"],
      ["Joe", "word"],
      [".", "punctuation"],
    ]);
  });

  test("preserves path-like tokens useful for chat/code contexts", () => {
    const document = FiloDocument.fromText("node_modules README.txt");
    const words = annotateWords(document);

    expect(words.map((word) => word.payload.surface)).toEqual(["node_modules", "README.txt"]);
  });
});
