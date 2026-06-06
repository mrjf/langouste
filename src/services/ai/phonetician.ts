import { adminDb } from "../../lib/db/index.ts";
import { transliterateTexts as litTransliterateTexts } from "../../../lit/src";
import type { Message } from "../../types/index.ts";

/** Build the storage key for a phonetic track. */
export function phoneticKey(system: string, language: string): string {
  return `${system}:${language}`;
}

/**
 * Generate phonetic transcriptions for a batch of texts.
 * Returns null if no provider supports the system+language combination.
 */
export async function transcribeTexts(
  texts: string[],
  system: string,
  language: string,
): Promise<string[] | null> {
  if (system !== "ipa") return null;
  try {
    const results = await litTransliterateTexts(texts, {
      from: { system: "orthography", language },
      to: { system: "ipa", language },
    });
    return results.map((result) => result.text);
  } catch (err) {
    if (err instanceof Error && /No deterministic lit provider/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Ensure phonetic transcriptions exist for the given messages, systems, and languages.
 * Generates missing transcriptions and persists them to the database.
 *
 * @param messages - Messages to process
 * @param systems - Phonetic systems to generate (e.g., ["ipa"])
 * @param languages - Languages to generate phonetics for (e.g., ["fr", "ja"])
 */
export async function ensurePhonetics(
  messages: Message[],
  systems: string[],
  languages: string[],
): Promise<Message[]> {
  for (const system of systems) {
    for (const lang of languages) {
      const key = phoneticKey(system, lang);
      const missing = messages.filter((m) => !m.phonetics?.[key]);
      if (missing.length === 0) continue;

      const texts = missing.map((m) => {
        // Use the translation in this language if available, otherwise healed_text
        return m.translations?.[lang] ?? m.healed_text;
      });

      const results = await transcribeTexts(texts, system, lang);
      if (!results) continue; // no provider for this combo

      for (let i = 0; i < missing.length; i++) {
        const msg = missing[i];
        const updated = { ...(msg.phonetics ?? {}), [key]: results[i] };
        msg.phonetics = updated;
        await adminDb().update("messages", { phonetics: updated }, [
          { op: "eq", column: "message_id", value: msg.message_id },
        ]);
      }
    }
  }

  return messages;
}
