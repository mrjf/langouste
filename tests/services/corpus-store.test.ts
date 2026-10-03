import { describe, expect, test } from "bun:test";
import { FiloDocument, annotateTranslation, annotateWords } from "filo";
import { createMemoryDatabaseSet } from "../../src/lib/db/memory.ts";
import { indexFiloDocument, searchCorpus } from "../../src/services/corpus/store.ts";

describe("turbopuffer corpus projection", () => {
  test("stores complete Filo tiers and searches source plus annotation text", async () => {
    const set = createMemoryDatabaseSet();
    const document = FiloDocument.fromText("A macska alszik.", {
      id: "workbench:corpus-test",
      metadata: { title: "Hungarian cat", language: "hu" },
    });
    annotateWords(document, { language: "hu", source: "test" });
    annotateTranslation(document, {
      start: 0,
      end: document.byteLength,
      language: "en",
      sourceLanguage: "hu",
      text: "The cat sleeps.",
      source: "test",
    });

    await indexFiloDocument(set.admin, document.toJSON(), {
      ownerId: "user-a",
      sourceType: "workbench",
      language: "hu",
    });

    const annotationMatch = await searchCorpus(set.admin, "sleeps", { ownerId: "user-a" });
    expect(annotationMatch).toHaveLength(1);
    expect(annotationMatch[0].filo_doc.tiers.map((tier) => tier.id)).toContain("translation:en");

    const projectedMatch = await searchCorpus(set.admin, "sleeps", {
      ownerId: "user-a",
      includeDocument: false,
    });
    expect(projectedMatch[0].tier_ids).toContain("translation:en");
    expect(projectedMatch[0].filo_doc).toBeUndefined();

    const isolated = await searchCorpus(set.admin, "sleeps", { ownerId: "user-b" });
    expect(isolated).toEqual([]);
  });
});
