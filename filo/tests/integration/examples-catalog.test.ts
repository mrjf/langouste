import { describe, expect, test } from "bun:test";
import { FiloDocument, buildCustomAnalysisDocument, buildExampleCatalog } from "../../src";

describe("example catalog", () => {
  test("builds rich visualizer examples with serializable documents", async () => {
    const examples = await buildExampleCatalog();

    expect(examples.map((example) => example.id)).toEqual([
      "langouste-hu",
      "english-overlap",
      "article-fixture",
      "transcript",
    ]);

    for (const example of examples) {
      const document = FiloDocument.fromJSON(example.document);
      expect(document.byteLength).toBeGreaterThan(0);
      expect(document.tiers().length).toBeGreaterThanOrEqual(4);
      expect(document.annotations().length).toBeGreaterThan(0);
    }
  });

  test("custom analysis creates words, phrases, sentences, dictionary, and links", async () => {
    const json = await buildCustomAnalysisDocument(
      "The layered document stores words and overlapping phrase tiers.",
      { language: "en" },
    );
    const document = FiloDocument.fromJSON(json);

    expect(document.tiers().map((tier) => tier.id)).toEqual([
      "word",
      "phrase",
      "sentence",
      "dictionary",
      "word:links",
    ]);
    expect(document.requireTier("phrase").annotations.length).toBeGreaterThan(0);
    expect(document.requireTier("dictionary").annotations.length).toBeGreaterThan(0);
  });
});
