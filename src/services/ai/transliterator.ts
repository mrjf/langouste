import { adminDb } from "../../lib/db/index.ts";
import { getTransliterationProvider } from "./transliteration/index.ts";
import type { Message } from "../../types/index.ts";

/** Languages that use non-Latin scripts and benefit from transliteration. */
const NON_LATIN_LANGUAGES = new Set([
  "ar",
  "zh",
  "ja",
  "ko",
  "ru",
  "hi",
  "th",
  "he",
  "fa",
  "uk",
  "el",
  "ka",
]);

/** Build the storage key for a transliteration pair. */
export function transliterationKey(sourceLang: string, targetLang: string): string {
  return `${sourceLang}→${targetLang}`;
}

/**
 * Whether transliteration is useful for this source language.
 * Latin-script languages don't need transliteration.
 */
export function needsTransliteration(sourceLang: string): boolean {
  return NON_LATIN_LANGUAGES.has(sourceLang);
}

/**
 * Transliterate a batch of texts from sourceLang for targetLang readers.
 */
export async function transliterateTexts(
  texts: string[],
  sourceLang: string,
  targetLang: string,
): Promise<string[]> {
  const provider = getTransliterationProvider(sourceLang, targetLang);
  return provider.transliterate(texts, sourceLang, targetLang);
}

/**
 * Ensure transliterations exist for the given messages and reader languages.
 * Only generates transliterations when the message's source language uses
 * a non-Latin script. Persists results to the database.
 */
export async function ensureTransliterations(
  messages: Message[],
  sourceLang: string,
  readerLanguages: string[],
): Promise<Message[]> {
  if (!needsTransliteration(sourceLang)) return messages;

  for (const targetLang of readerLanguages) {
    const key = transliterationKey(sourceLang, targetLang);
    const missing = messages.filter((m) => !m.transliterations?.[key]);
    if (missing.length === 0) continue;

    const texts = missing.map((m) => m.healed_text);
    const results = await transliterateTexts(texts, sourceLang, targetLang);

    for (let i = 0; i < missing.length; i++) {
      const msg = missing[i];
      const updated = { ...(msg.transliterations ?? {}), [key]: results[i] };
      msg.transliterations = updated;
      await adminDb().update("messages", { transliterations: updated }, [
        { op: "eq", column: "message_id", value: msg.message_id },
      ]);
    }
  }

  return messages;
}
