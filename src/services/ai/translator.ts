import { supabaseAdmin } from "../../lib/supabase-client.ts";
import { getTranslationProvider } from "./translation/index.ts";
import type { Message } from "../../types/index.ts";

/**
 * Translate a batch of texts into a target language.
 * Returns translations in the same order as the input.
 */
export async function translateTexts(
  texts: string[],
  targetLanguage: string,
  context?: string,
): Promise<string[]> {
  const provider = getTranslationProvider();
  const providerName = provider.constructor.name;
  console.log(`[Translation] [${providerName}] ${texts.length} text(s) → ${targetLanguage}: ${texts.map(t => `"${t.slice(0, 50)}"`).join(", ")}`);
  const results = await provider.translateTexts(texts, targetLanguage, context);
  console.log(`[Translation] [${providerName}] Results: ${results.map(t => `"${t.slice(0, 50)}"`).join(", ")}`);
  return results;
}

/**
 * Ensure that all given messages have translations for the specified languages.
 * Generates missing translations via the configured provider and persists them
 * via the admin client (bypasses RLS since there's no UPDATE policy on messages).
 * Mutates the messages in place and returns them.
 */
export async function ensureTranslations(
  messages: Message[],
  languages: string[],
): Promise<Message[]> {
  // Filter out empty/falsy language codes
  const validLanguages = languages.filter((l) => l && l.trim());
  for (const lang of validLanguages) {
    // Skip messages that already have a translation, or whose source language
    // matches the target (translating French→French would fail).
    const missing = messages.filter(
      (m) => !m.translations?.[lang] && m.language !== lang,
    );
    if (missing.length === 0) continue;

    const texts = missing.map((m) => m.healed_text);
    let translated: string[];
    try {
      translated = await translateTexts(texts, lang);
    } catch (err) {
      console.error(`Translation to ${lang} failed, skipping:`, (err as Error).message);
      continue;
    }

    for (let i = 0; i < missing.length; i++) {
      const msg = missing[i];
      const updated = { ...(msg.translations ?? {}), [lang]: translated[i] };
      msg.translations = updated;
      await supabaseAdmin
        .from("messages")
        .update({ translations: updated })
        .eq("message_id", msg.message_id);
    }
  }

  return messages;
}
