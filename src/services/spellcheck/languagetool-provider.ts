import type { LanguageCode, TextError } from "../../types/index.ts";
import type { SpellCheckProvider } from "./provider.ts";

const LANGUAGETOOL_URL = process.env.LANGUAGETOOL_URL ?? "https://api.languagetool.org/v2";

// Map our ISO 639-1 codes to LanguageTool's expected codes
const LANG_MAP: Record<string, string> = {
  en: "en-US",
  fr: "fr",
  es: "es",
  de: "de-DE",
  hu: "hu",
  it: "it",
  pt: "pt-PT",
  nl: "nl",
  ru: "ru",
  pl: "pl",
  tr: "tr",
  zh: "zh",
  ja: "ja",
  ko: "ko",
  ar: "ar",
};

/**
 * Spell and grammar checker using LanguageTool API.
 * Handles contractions, compounds, grammar rules, and more —
 * no hacks needed for "est-ce", "qu'est-ce que", etc.
 *
 * Uses the free public API by default.
 * Set LANGUAGETOOL_URL env var to use a self-hosted instance.
 */
export class LanguageToolProvider implements SpellCheckProvider {
  readonly name = "languagetool";

  supportsLanguage(lang: LanguageCode): boolean {
    return lang in LANG_MAP;
  }

  async check(text: string, language: LanguageCode): Promise<TextError[]> {
    const ltLang = LANG_MAP[language];
    if (!ltLang) return [];

    try {
      const body = new URLSearchParams({
        text,
        language: ltLang,
        disabledCategories: "TYPOGRAPHY,REDUNDANCY,STYLE,CASING",
      });

      const res = await fetch(`${LANGUAGETOOL_URL}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.error(`[LanguageTool] API returned ${res.status}: ${await res.text()}`);
        return [];
      }

      const data = (await res.json()) as {
        matches: Array<{
          offset: number;
          length: number;
          message: string;
          shortMessage: string;
          rule: { id: string; category: { id: string } };
          replacements: Array<{ value: string }>;
        }>;
      };

      return data.matches.map((m) => {
        const kind =
          m.rule.category.id === "TYPOS" || m.rule.category.id === "SPELLING"
            ? ("spelling" as const)
            : ("grammar" as const);

        return {
          start: m.offset,
          end: m.offset + m.length,
          text: text.slice(m.offset, m.offset + m.length),
          kind,
          suggestions: m.replacements.slice(0, 5).map((r) => r.value),
        };
      });
    } catch (err) {
      console.error(`[LanguageTool] Request failed:`, (err as Error).message);
      return [];
    }
  }
}
