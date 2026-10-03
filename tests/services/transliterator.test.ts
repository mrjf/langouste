import "./_db-harness.ts";
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { transliterationForLanguage } from "../../src/client/lib/transliteration.ts";
import { adminDb } from "../../src/lib/db/index.ts";
import {
  ensureTransliterations,
  needsTransliteration,
  transliterationKey,
} from "../../src/services/ai/transliterator.ts";
import type { Message } from "../../src/types/index.ts";

describe("message transliteration", () => {
  test("detects arbitrary non-Latin language scripts", () => {
    expect(needsTransliteration("ar")).toBe(true);
    expect(needsTransliteration("bn")).toBe(true);
    expect(needsTransliteration("am")).toBe(true);
    expect(needsTransliteration("sr-Cyrl")).toBe(true);
    expect(needsTransliteration("sr-Latn")).toBe(false);
    expect(needsTransliteration("fr")).toBe(false);
  });

  test("transliterates a non-Latin translated track, not only the source text", async () => {
    const message = await adminDb().insert<Message>("messages", {
      message_id: randomUUID(),
      conversation_id: randomUUID(),
      sender_id: randomUUID(),
      raw_text: "Hello",
      healed_text: "Hello",
      language: "en",
      translation: null,
      translations: { en: "Hello", ar: "مرحبا" },
      corrections: [],
      next_challenge: null,
    });

    await ensureTransliterations([message], "en", ["ar", "en"]);

    const arabicForEnglishReaders = message.transliterations[transliterationKey("ar", "en")];
    expect(arabicForEnglishReaders).toBeTruthy();
    expect(arabicForEnglishReaders).not.toMatch(/\p{Script=Arabic}/u);
  });

  test("prefers the reader's transliteration convention and falls back to any stored track", () => {
    const tracks = { "ar→fr": "marhaban-fr", "ar→en": "marhaban-en" };
    expect(transliterationForLanguage(tracks, "ar", ["en", "fr"])).toBe("marhaban-en");
    expect(transliterationForLanguage(tracks, "ar", ["de"])).toBe("marhaban-fr");
  });
});
