import { afterEach, describe, expect, test } from "bun:test";
import { analyzeWorkbenchDocument } from "../../src/services/corpus/workbench.ts";
import { clearDictionaryLookupCache } from "../../src/services/references/dictionary.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDictionaryLookupCache();
});

describe("workbench analysis", () => {
  test("creates sentence, phrase, dictionary, and literal translation tiers", async () => {
    mockWiktionary({
      Szétszórva: null,
      szétszórva: null,
      szétszór: null,
      szór: page("szór", "Hungarian", "Verb", ["to sprinkle, scatter"]),
      ebben: null,
    });

    const result = await analyzeWorkbenchDocument({
      text: "Szétszórva ebben.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });

    expect(result.summary).toMatchObject({
      words: 2,
      sentences: 1,
      phrases: 1,
      targetLanguage: "en",
    });
    expect(result.document.tiers.map((tier) => tier.id)).toContain("sentence");
    expect(result.document.tiers.map((tier) => tier.id)).toContain("phrase");
    expect(result.document.tiers.map((tier) => tier.id)).toContain("dictionary");
    expect(result.document.tiers.map((tier) => tier.id)).toContain("ipa:hu");

    const literalSentence = result.document.tiers.find(
      (tier) => tier.id === "sentence.translation:en:literal",
    );
    expect(literalSentence?.annotations[0].payload.text).toBe("to sprinkle, scatter · in this");
    expect(literalSentence?.annotations[0].payload).toMatchObject({
      level: "sentence",
      mode: "literal",
      glossLanguage: "en",
    });

    const wordLiteral = result.document.tiers.find(
      (tier) => tier.id === "word.translation:en:literal",
    );
    expect(wordLiteral?.annotations.map((annotation) => annotation.payload.text)).toEqual([
      "to sprinkle, scatter",
      "in this",
    ]);
    expect(wordLiteral?.annotations[0].payload).toMatchObject({
      level: "word",
      mode: "literal",
      glossLanguage: "en",
      surface: "Szétszórva",
      lemma: "szétszór",
      glossSource: "dictionary",
    });

    const ipa = result.document.tiers.find((tier) => tier.id === "ipa:hu");
    expect(ipa?.annotations[0].payload).toMatchObject({
      system: "ipa",
      language: "hu",
      sourceText: "Szétszórva ebben.",
      provider: "rule-ipa",
    });
  });

  test("reuses a completed Filo workbench analysis without re-annotating", async () => {
    let fetches = 0;
    mockWiktionary({
      ebben: null,
    });
    const countingFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches += 1;
      return countingFetch(...args);
    }) as typeof fetch;

    const first = await analyzeWorkbenchDocument({
      text: "Ebben.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });
    const firstFetches = fetches;
    globalThis.fetch = (async () => {
      throw new Error("cache miss");
    }) as typeof fetch;

    const second = await analyzeWorkbenchDocument({
      text: "Ebben.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
      document: first.document,
    });

    expect(firstFetches).toBeGreaterThan(0);
    expect(second.document).toEqual(first.document);
    expect(tier(second.document, "word")?.annotations).toHaveLength(1);
    expect(tier(second.document, "dictionary")?.annotations).toHaveLength(1);
    expect(tier(second.document, "word.translation:en:literal")?.annotations).toHaveLength(1);
    expect(tier(second.document, "sentence.translation:en:literal")?.annotations).toHaveLength(1);
  });
});

function tier(document: { tiers: Array<{ id: string; annotations: unknown[] }> }, tierId: string) {
  return document.tiers.find((candidate) => candidate.id === tierId);
}

function mockWiktionary(pages: Record<string, string | null>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const title = url.searchParams.get("page") ?? "";
    const html = pages[title];
    if (!html) {
      return Response.json({ error: { code: "missingtitle" } });
    }
    return Response.json({ parse: { title, text: { "*": html } } });
  }) as typeof fetch;
}

function page(
  title: string,
  language: string,
  partOfSpeech: string,
  definitions: string[],
): string {
  const list = definitions.map((definition) => `<li>${definition}</li>`).join("");
  return `
    <div class="mw-heading mw-heading2"><h2 id="${language}">${language}</h2></div>
    <div class="mw-heading mw-heading3"><h3 id="${partOfSpeech}">${partOfSpeech}</h3></div>
    <ol>${list}</ol>
    <div class="mw-heading mw-heading2"><h2 id="Other">Other</h2></div>
    <p>${title}</p>
  `;
}
