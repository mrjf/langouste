import { adminDb } from "../../lib/db/index.ts";
import { containsNonLatinLetters, languageUsesNonLatinScript } from "../../lib/language-scripts.ts";
import { getTransliterationProvider } from "./transliteration/index.ts";
import type { Message } from "../../types/index.ts";

/** Build the storage key for a transliteration pair. */
export function transliterationKey(sourceLang: string, targetLang: string): string {
  return `${sourceLang}→${targetLang}`;
}

/**
 * Whether transliteration is useful for this source language.
 * Latin-script languages don't need transliteration.
 */
export function needsTransliteration(sourceLang: string): boolean {
  return languageUsesNonLatinScript(sourceLang);
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
 * Covers both source text and translated tracks that use a non-Latin script,
 * then persists the results to the database.
 */
export async function ensureTransliterations(
  messages: Message[],
  sourceLang: string,
  readerLanguages: string[],
): Promise<Message[]> {
  const readers = [...new Set(readerLanguages.filter((language) => language?.trim()))];
  const contentLanguages = [
    ...new Set([sourceLang, ...readers].filter((language) => language?.trim())),
  ];

  for (const contentLanguage of contentLanguages) {
    const candidates = messages
      .map((message) => ({ message, text: textForLanguage(message, contentLanguage) }))
      .filter(
        (candidate): candidate is { message: Message; text: string } => !!candidate.text?.trim(),
      );
    if (candidates.length === 0) continue;
    if (
      !needsTransliteration(contentLanguage) &&
      !candidates.some((candidate) => containsNonLatinLetters(candidate.text))
    ) {
      continue;
    }

    for (const readerLanguage of readers) {
      const key = transliterationKey(contentLanguage, readerLanguage);
      const missing = candidates.filter(({ message }) => !message.transliterations?.[key]);
      if (missing.length === 0) continue;

      const results = await transliterateTexts(
        missing.map(({ text }) => text),
        contentLanguage,
        readerLanguage,
      );

      for (let index = 0; index < missing.length; index += 1) {
        const message = missing[index].message;
        const updated = { ...(message.transliterations ?? {}), [key]: results[index] };
        message.transliterations = updated;
        await adminDb().update("messages", { transliterations: updated }, [
          { op: "eq", column: "message_id", value: message.message_id },
        ]);
      }
    }
  }

  return messages;
}

function textForLanguage(message: Message, language: string): string | null {
  if (message.language === language) return message.healed_text;
  return message.translations?.[language] ?? null;
}
