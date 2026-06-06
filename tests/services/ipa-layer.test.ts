import { describe, expect, test } from "bun:test";
import { formatIpa, ipaForText } from "../../src/client/lib/ipa-layer.ts";
import type { FiloDocumentJson } from "../../src/client/lib/stores.svelte.ts";

describe("client IPA layer lookup", () => {
  test("finds IPA for a translated text stored on a message Filo document", () => {
    const document = filoDocument("Bonjour.", [
      ipaAnnotation("ipa:fr", "fr", "Bonjour.", "bɔ̃ʒuʁ", 0, 8),
      ipaAnnotation("ipa:en", "en", "Hello.", "həˈloʊ", 0, 8),
    ]);

    expect(ipaForText("Hello.", "en", document)).toBe("həˈloʊ");
  });

  test("finds IPA for source text by byte range", () => {
    const document = filoDocument("Szia.", [ipaAnnotation("ipa:hu", "hu", "Szia.", "siɒ", 0, 5)]);

    expect(ipaForText("Szia.", "hu", document)).toBe("siɒ");
  });

  test("formats raw IPA with slashes without double wrapping existing notation", () => {
    expect(formatIpa("siɒ")).toBe("/siɒ/");
    expect(formatIpa("/siɒ/")).toBe("/siɒ/");
  });
});

function filoDocument(
  text: string,
  annotations: FiloDocumentJson["tiers"][number]["annotations"],
): FiloDocumentJson {
  return {
    id: "message:test",
    text,
    byteLength: new TextEncoder().encode(text).length,
    metadata: {
      corpus: "messages",
      language: "fr",
    },
    tiers: [
      {
        id: "ipa:fr",
        kind: "phonetic",
        source: "test",
        annotations: annotations.filter((annotation) => annotation.tierId === "ipa:fr"),
      },
      {
        id: "ipa:en",
        kind: "phonetic",
        source: "test",
        annotations: annotations.filter((annotation) => annotation.tierId === "ipa:en"),
      },
      {
        id: "ipa:hu",
        kind: "phonetic",
        source: "test",
        annotations: annotations.filter((annotation) => annotation.tierId === "ipa:hu"),
      },
    ],
  };
}

function ipaAnnotation(
  tierId: string,
  language: string,
  sourceText: string,
  text: string,
  start: number,
  end: number,
) {
  return {
    id: `${tierId}:${sourceText}`,
    tierId,
    kind: "phonetic",
    start,
    end,
    source: "test",
    payload: {
      system: "ipa",
      language,
      sourceText,
      text,
    },
  };
}
