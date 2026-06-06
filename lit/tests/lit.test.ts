import { describe, expect, test } from "bun:test";
import { transliterateText, transliterateTexts } from "../src";

describe("lit transliteration", () => {
  test("transliterates non-Latin scripts to Latin", async () => {
    const result = await transliterateText("Привет мир", {
      from: { system: "orthography", language: "ru" },
      to: { system: "latin", language: "en" },
    });

    expect(result.provider).toBe("unicode-latin");
    expect(result.text).toBe("Privet mir");
  });

  test("generates dictionary-backed English IPA through phonemize", async () => {
    const result = await transliterateText("hello world", {
      from: { system: "orthography", language: "en" },
      to: { system: "ipa", language: "en" },
    });

    expect(result.provider).toBe("phonemize");
    expect(result.text).toContain("hə");
    expect(result.text).toMatch(/^\/.*\/$/u);
  });

  test("generates Chinese IPA with tone marks", async () => {
    const result = await transliterateText("中文", {
      from: { system: "orthography", language: "zh" },
      to: { system: "ipa", language: "zh" },
    });

    expect(result.provider).toBe("phonemize");
    expect(result.text).toContain("ʈʂ");
    expect(result.text).toContain("˥");
  });

  test("uses piper-plus for French IPA and normalizes private-use symbols", async () => {
    const result = await transliterateText("Bonjour le monde", {
      from: { system: "orthography", language: "fr" },
      to: { system: "ipa", language: "fr" },
    });

    expect(result.provider).toBe("piper-plus-g2p");
    expect(result.text).toContain("ɔ̃");
    expect(result.text).not.toMatch(/[\uE000-\uF8FF]/u);
  });

  test("falls back to local rules for Hungarian", async () => {
    const result = await transliterateText("Számos található", {
      from: { system: "orthography", language: "hu" },
      to: { system: "ipa", language: "hu" },
    });

    expect(result.provider).toBe("rule-ipa");
    expect(result.text).toContain("ˈsaːmoʃ");
    expect(result.text).toContain("ˈtɒlaːlhɒtoː");
    expect(result.text).toContain("saːmoʃ");
    expect(result.text).toContain("tɒlaːlhɒtoː");
  });

  test("marks deterministic Hungarian initial stress", async () => {
    const result = await transliterateText("segít", {
      from: { system: "orthography", language: "hu" },
      to: { system: "ipa", language: "hu" },
    });

    expect(result.provider).toBe("rule-ipa");
    expect(result.text).toBe("/ˈʃɛɡiːt/");
  });

  test("uses caller dictionaries before providers", async () => {
    const results = await transliterateTexts(["Langouste"], {
      from: { system: "orthography", language: "fr" },
      to: { system: "ipa", language: "fr" },
      dictionaries: [
        {
          id: "fixture",
          lookup: ({ text }) => (text === "Langouste" ? { text: "/lɑ̃ɡust/" } : null),
        },
      ],
    });
    const result = results[0];
    if (!result) throw new Error("Expected a transliteration result");

    expect(result.provider).toBe("dictionary:fixture");
    expect(result.text).toBe("/lɑ̃ɡust/");
  });
});
