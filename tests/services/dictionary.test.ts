import { afterEach, describe, expect, test } from "bun:test";
import {
  clearDictionaryLookupCache,
  lookupDictionary,
} from "../../src/services/references/dictionary.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDictionaryLookupCache();
});

describe("lookupDictionary", () => {
  test("follows Wiktionary inflected-form definitions to the lemma page", async () => {
    mockWiktionary({
      manges: page("manges", "French", [
        'second-person singular present indicative/subjunctive of <a href="/wiki/manger#French">manger</a>',
      ]),
      manger: page("manger", "French", ["to eat"]),
    });

    const lookup = await lookupDictionary("manges", "fr");

    expect(lookup.source_term).toBe("manger");
    expect(lookup.definitions).toEqual(["to eat"]);
  });

  test("preserves the inflected-form description when resolving to a lemma", async () => {
    mockWiktionary({
      tudnád: page("tudnád", "Hungarian", [
        'second-person singular conditional present definite of <a href="/wiki/tud#Hungarian">tud</a>',
      ]),
      tud: page("tud", "Hungarian", ["to know"]),
    });

    const lookup = await lookupDictionary("tudnád", "hu");

    expect(lookup.source_term).toBe("tud");
    expect(lookup.form_description).toBe(
      "second-person singular conditional present definite of tud",
    );
    expect(lookup.definitions).toEqual(["to know"]);
  });

  test("links to English definitions and target-language Wiktionary", async () => {
    mockWiktionary({
      projekt: page("projekt", "Hungarian", ["project"]),
    });

    const lookup = await lookupDictionary("projekt", "hu");

    expect(lookup.source_url).toBe("https://en.wiktionary.org/wiki/projekt#Hungarian");
    expect(lookup.target_source_url).toBe("https://hu.wiktionary.org/wiki/projekt");
  });

  test("tries lowercase exact lookup for capitalized words", async () => {
    mockWiktionary({
      Projekt: null,
      projekt: page("projekt", "Hungarian", ["project"]),
    });

    const lookup = await lookupDictionary("Projekt", "hu");

    expect(lookup.source_term).toBe("projekt");
    expect(lookup.definitions).toEqual(["project"]);
  });

  test("does not cache a capitalized miss over the lowercase lookup", async () => {
    mockWiktionary({
      Projekt: null,
      projekt: page("projekt", "Hungarian", ["project"]),
    });

    const capitalized = await lookupDictionary("Projekt", "hu");
    const lowercase = await lookupDictionary("projekt", "hu");

    expect(capitalized.definitions).toEqual(["project"]);
    expect(lowercase.definitions).toEqual(["project"]);
  });

  test("tries conservative Hungarian verb-stem candidates when no form page exists", async () => {
    mockWiktionary({
      megtalálom: null,
      megtalál: page("megtalál", "Hungarian", ["to find after searching"]),
    });

    const lookup = await lookupDictionary("megtalálom", "hu");

    expect(lookup.source_term).toBe("megtalál");
    expect(lookup.form_description).toBe("first-person singular present definite of megtalál");
    expect(lookup.definitions).toEqual(["to find after searching"]);
    expect(lookup.senses[0]?.part_of_speech).toBe("Verb");
  });

  test("lemmatizes capitalized Hungarian inflected words through lowercase candidates", async () => {
    mockWiktionary({
      Megtalálom: null,
      megtalálom: null,
      megtalál: page("megtalál", "Hungarian", ["to find after searching"]),
    });

    const lookup = await lookupDictionary("Megtalálom", "hu");

    expect(lookup.source_term).toBe("megtalál");
    expect(lookup.form_description).toBe("first-person singular present definite of megtalál");
    expect(lookup.definitions).toEqual(["to find after searching"]);
  });

  test("decodes named, decimal, and hex HTML entities in definitions", async () => {
    mockWiktionary({
      kíván: page("kíván", "Hungarian", [
        "to wish somebody something &mdash; Sok szerencs&eacute;t&#33; &#x1F44D;",
      ]),
    });

    const lookup = await lookupDictionary("kíván", "hu");

    expect(lookup.definitions).toEqual(["to wish somebody something — Sok szerencsét! 👍"]);
  });

  test("separates examples from definition text", async () => {
    mockWiktionary({
      kíván: `
        <div class="mw-heading mw-heading2"><h2 id="Hungarian">Hungarian</h2></div>
        <div class="mw-heading mw-heading3"><h3 id="Verb">Verb</h3></div>
        <ol>
          <li>to wish somebody something
            <dl><dd>Sok szerencs&eacute;t k&iacute;v&aacute;nok&#33;</dd></dl>
          </li>
        </ol>
      `,
    });

    const lookup = await lookupDictionary("kíván", "hu");

    expect(lookup.definitions).toEqual(["to wish somebody something"]);
    expect(lookup.senses).toEqual([
      {
        part_of_speech: "Verb",
        definition: "to wish somebody something",
        examples: ["Sok szerencsét kívánok!"],
      },
    ]);
  });

  test("skips etymology lists and reads part-of-speech definitions", async () => {
    mockWiktionary({
      egy: `
        <div class="mw-heading mw-heading2"><h2 id="Hungarian">Hungarian</h2></div>
        <div class="mw-heading mw-heading3"><h3 id="Etymology_2">Etymology</h3></div>
        <ol><li>Lexicalization of <a href="/wiki/e#Hungarian">e</a>/ez plus suffixes.</li></ol>
        <div class="mw-heading mw-heading3"><h3 id="Numeral">Numeral</h3></div>
        <ol><li class="mw-empty-elt"></li><li class="senseid" id="Hungarian:one">one</li></ol>
        <div class="mw-heading mw-heading4"><h4 id="Declension">Declension</h4></div>
        <ol><li>not a definition table row</li></ol>
        <div class="mw-heading mw-heading3"><h3 id="Article">Article</h3></div>
        <ol><li>a; an</li></ol>
      `,
      e: `
        <div class="mw-heading mw-heading2"><h2 id="Hungarian">Hungarian</h2></div>
        <div class="mw-heading mw-heading3"><h3 id="Pronoun">Pronoun</h3></div>
        <ol><li>this</li></ol>
      `,
    });

    const lookup = await lookupDictionary("egy", "hu");

    expect(lookup.definitions).toEqual(["one", "a; an"]);
  });
});

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

function page(title: string, language: string, definitions: string[]): string {
  const list = definitions.map((definition) => `<li>${definition}</li>`).join("");
  return `
    <div class="mw-heading mw-heading2"><h2 id="${language}">${language}</h2></div>
    <div class="mw-heading mw-heading3"><h3 id="Verb">Verb</h3></div>
    <ol>${list}</ol>
    <div class="mw-heading mw-heading2"><h2 id="Other">Other</h2></div>
    <p>${title}</p>
  `;
}
