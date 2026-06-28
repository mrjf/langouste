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
      Más: null,
      más: page("más", "Hungarian", "Pronoun", ["other"]),
    });
    const countingFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches += 1;
      return countingFetch(...args);
    }) as typeof fetch;

    const first = await analyzeWorkbenchDocument({
      text: "Más.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });
    const firstFetches = fetches;
    globalThis.fetch = (async () => {
      throw new Error("cache miss");
    }) as typeof fetch;

    const second = await analyzeWorkbenchDocument({
      text: "Más.",
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

  test("does not reuse a proper-translation analysis when proper tiers are missing", async () => {
    mockWiktionary({
      Szia: null,
      szia: null,
      barátom: null,
    });

    const first = await analyzeWorkbenchDocument({
      text: "Szia barátom.",
      sourceLanguage: "hu",
      targetLanguage: "hu",
      includeProperTranslations: true,
    });
    const stale = {
      ...first.document,
      tiers: first.document.tiers.filter((candidate) => !candidate.id.endsWith(":proper")),
    };

    const second = await analyzeWorkbenchDocument({
      text: "Szia barátom.",
      sourceLanguage: "hu",
      targetLanguage: "hu",
      includeProperTranslations: true,
      document: stale,
    });

    expect(tier(stale, "sentence.translation:hu:proper")).toBeUndefined();
    expect(
      tier(second.document, "sentence.translation:hu:proper")?.annotations[0]?.payload,
    ).toMatchObject({
      text: "Szia barátom.",
      mode: "proper",
    });
    expect(
      tier(second.document, "phrase.translation:hu:proper")?.annotations[0]?.payload,
    ).toMatchObject({
      text: "Szia barátom.",
      mode: "proper",
    });
  });

  test("uses verbatim fallback glosses for dictionary misses", async () => {
    mockWiktionary({
      Codex: null,
      codex: null,
    });

    const result = await analyzeWorkbenchDocument({
      text: "Codex.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });

    const dictionary = tier(result.document, "dictionary")?.annotations[0] as any;
    expect(dictionary?.payload).toMatchObject({
      surface: "Codex",
      language: "hu",
      lookupStatus: "not-found",
      notFound: true,
    });

    const wordLiteral = tier(result.document, "word.translation:en:literal")?.annotations[0] as any;
    expect(wordLiteral?.payload).toMatchObject({
      text: "Codex",
      mode: "literal",
      glossLanguage: "en",
      surface: "Codex",
      glossSource: "not-found",
      notFound: true,
    });

    const sentenceLiteral = tier(result.document, "sentence.translation:en:literal")
      ?.annotations[0] as any;
    expect(sentenceLiteral?.payload.text).toBe("Codex");
    expect(sentenceLiteral?.payload.glosses[0]).toMatchObject({
      surface: "Codex",
      gloss: "Codex",
      source: "not-found",
      notFound: true,
    });
  });

  test("annotates grammar properties on sentence, phrase, and word spans", async () => {
    mockWiktionary({
      Jó: null,
      jó: page("jó", "Hungarian", "Adjective", ["good"]),
      napot: null,
      Ön: null,
      ön: null,
      nem: page("nem", "Hungarian", "Adverb", ["not"]),
      kérek: null,
      kér: page("kér", "Hungarian", "Verb", ["to ask for"]),
      kávét: null,
    });

    const result = await analyzeWorkbenchDocument({
      text: "Jó napot, Ön nem kérek kávét?",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });

    const grammar = tier(result.document, "grammar")?.annotations as any[];
    expect(grammar?.map((annotation) => annotation.payload.category)).toContain(
      "sentence:mood.interrogative",
    );
    expect(grammar?.map((annotation) => annotation.payload.category)).toContain(
      "u:syntax:negation.placement",
    );
    expect(grammar?.map((annotation) => annotation.payload.category)).toContain("person:first");
    expect(grammar?.map((annotation) => annotation.payload.category)).toContain(
      "pragmatics:greeting",
    );
    expect(grammar?.map((annotation) => annotation.payload.category)).toContain(
      "formality:register",
    );

    const negation = grammar.filter(
      (annotation) => annotation.payload.category === "u:syntax:negation.placement",
    );
    expect(negation.map((annotation) => annotation.payload.level).sort()).toEqual([
      "phrase",
      "word",
    ]);
    expect(negation.map((annotation) => textOf(result.document, annotation)).sort()).toEqual([
      "nem",
      "Ön nem kérek kávét?",
    ]);

    const interrogative = grammar.find(
      (annotation) => annotation.payload.category === "sentence:mood.interrogative",
    );
    expect(interrogative?.payload).toMatchObject({
      level: "sentence",
      conceptId: "hu:grammar:sentence:mood.interrogative",
      label: "Interrogative",
    });
    expect(interrogative?.payload.references?.length).toBeGreaterThan(0);

    const greeting = grammar.find(
      (annotation) => annotation.payload.category === "pragmatics:greeting",
    );
    expect(textOf(result.document, greeting)).toBe("Jó napot");
  });

  test("marks dictionary lookup errors separately from clean misses", async () => {
    globalThis.fetch = (async () => {
      throw new Error("dictionary service unavailable");
    }) as typeof fetch;

    const result = await analyzeWorkbenchDocument({
      text: "Codex.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });

    const dictionary = tier(result.document, "dictionary")?.annotations[0] as any;
    expect(dictionary?.payload).toMatchObject({
      surface: "Codex",
      language: "hu",
      lookupStatus: "error",
      lookupError: "dictionary service unavailable",
      notFound: false,
      definitions: [],
    });
    expect(tier(result.document, "word.translation:en:literal")?.annotations ?? []).toHaveLength(0);
    expect(
      tier(result.document, "sentence.translation:en:literal")?.annotations ?? [],
    ).toHaveLength(0);
  });

  test("does not reuse analyses with dictionary lookup errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("temporary dictionary outage");
    }) as typeof fetch;

    const stale = await analyzeWorkbenchDocument({
      text: "Más.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
    });
    expect((tier(stale.document, "dictionary")?.annotations[0] as any)?.payload).toMatchObject({
      lookupStatus: "error",
    });

    mockWiktionary({
      Más: null,
      más: page("más", "Hungarian", "Pronoun", ["other"]),
    });

    const refreshed = await analyzeWorkbenchDocument({
      text: "Más.",
      sourceLanguage: "hu",
      targetLanguage: "en",
      includeProperTranslations: false,
      document: stale.document,
    });

    expect((tier(refreshed.document, "dictionary")?.annotations[0] as any)?.payload).toMatchObject({
      lookupStatus: "found",
      notFound: false,
      definitions: ["other"],
    });
    expect(
      (tier(refreshed.document, "word.translation:en:literal")?.annotations[0] as any)?.payload,
    ).toMatchObject({
      text: "other",
      glossSource: "dictionary",
    });
  });
});

function tier(document: { tiers: Array<{ id: string; annotations: unknown[] }> }, tierId: string) {
  return document.tiers.find((candidate) => candidate.id === tierId);
}

function textOf(document: { text: string }, range: { start: number; end: number }): string {
  const start = stringIndexForByteOffset(document.text, range.start);
  const end = stringIndexForByteOffset(document.text, range.end);
  return document.text.slice(start, end);
}

function stringIndexForByteOffset(value: string, byteOffset: number): number {
  const encoder = new TextEncoder();
  const target = Math.max(0, Math.min(byteOffset, encoder.encode(value).length));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const bytes = encoder.encode(value.slice(0, mid)).length;
    if (bytes < target) low = mid + 1;
    else high = mid;
  }
  return low;
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
