import nspell from "nspell";
import type { LanguageCode, TextError } from "../../types/index.ts";
import type { SpellCheckProvider } from "./provider.ts";
import { tokenize } from "./tokenizer.ts";

// Common elision prefixes that result from apostrophe splitting.
// These are valid word fragments, not misspellings.
const ELISION_PREFIXES = new Set([
  // French
  "l",
  "d",
  "j",
  "n",
  "s",
  "c",
  "m",
  "t",
  "qu",
  "jusqu",
  "lorsqu",
  "puisqu",
  "quelqu",
  // Italian
  "un",
  "dell",
  "nell",
  "all",
  "sull",
]);

const MIN_TOKEN_LENGTH = 2;

// nspell's suggest() is cheap for a near-miss typo (~10ms) but expensive
// for gibberish (~0.5-1s each — it exhaustively searches with no close
// match). A message of several nonsense "words" would otherwise stack up
// to many seconds and hang "checking…". Cap the total time spent on
// suggestions per check; misspellings are still flagged immediately, they
// just stop getting an inline suggestion list once the budget is spent
// (Opus explains the fix anyway).
const SUGGEST_BUDGET_MS = 300;

// Map of language codes to their dictionary package import functions
const DICTIONARY_LOADERS: Record<string, () => Promise<{ aff: Buffer; dic: Buffer }>> = {
  fr: () => import("dictionary-fr").then((m) => m.default as any),
  es: () => import("dictionary-es").then((m) => m.default as any),
  de: () => import("dictionary-de").then((m) => m.default as any),
  hu: () => import("dictionary-hu").then((m) => m.default as any),
  it: () => import("dictionary-it").then((m) => m.default as any),
  pt: () => import("dictionary-pt").then((m) => m.default as any),
  nl: () => import("dictionary-nl").then((m) => m.default as any),
  ru: () => import("dictionary-ru").then((m) => m.default as any),
  pl: () => import("dictionary-pl").then((m) => m.default as any),
  tr: () => import("dictionary-tr").then((m) => m.default as any),
};

const cache = new Map<string, nspell>();
const loading = new Map<string, Promise<nspell | null>>();

async function getDictionary(lang: LanguageCode): Promise<nspell | null> {
  const cached = cache.get(lang);
  if (cached) return cached;

  const existing = loading.get(lang);
  if (existing) return existing;

  const loader = DICTIONARY_LOADERS[lang];
  if (!loader) return null;

  const promise = (async () => {
    try {
      const dict = await loader();
      const instance = nspell(dict.aff, dict.dic);
      cache.set(lang, instance);
      return instance;
    } catch (err) {
      console.error(`[nspell] Failed to load dictionary for ${lang}:`, err);
      return null;
    }
  })();

  loading.set(lang, promise);
  const result = await promise;
  loading.delete(lang);
  return result;
}

/**
 * Spell-check provider using nspell (hunspell dictionaries).
 * Fast, deterministic, offline. Covers spelling only (not grammar).
 */
export class NspellProvider implements SpellCheckProvider {
  readonly name = "nspell";

  supportsLanguage(lang: LanguageCode): boolean {
    return lang in DICTIONARY_LOADERS;
  }

  async check(text: string, language: LanguageCode): Promise<TextError[]> {
    const dict = await getDictionary(language);
    if (!dict) return [];

    const tokens = tokenize(text);

    // Pass 1: find every misspelling (fast — correct() is ~constant time).
    // No suggest() here so flagging never blocks on gibberish.
    const misspelled: TextError[] = [];
    for (const token of tokens) {
      const word = token.word;

      if (word.length < MIN_TOKEN_LENGTH) continue;
      if (ELISION_PREFIXES.has(word.toLowerCase())) continue;
      if (dict.correct(word) || dict.correct(word.toLowerCase())) continue;

      // For hyphenated words (est-ce, peut-être), check each part individually.
      // If all parts are correct, the compound is correct.
      if (word.includes("-")) {
        const parts = word.split("-");
        const allPartsCorrect = parts.every(
          (p) =>
            p.length < MIN_TOKEN_LENGTH ||
            ELISION_PREFIXES.has(p.toLowerCase()) ||
            dict.correct(p) ||
            dict.correct(p.toLowerCase()),
        );
        if (allPartsCorrect) continue;
      }

      misspelled.push({
        start: token.start,
        end: token.end,
        text: word,
        kind: "spelling",
        suggestions: [],
      });
    }

    // Pass 2: fill suggestions within a shared time budget. Once spent,
    // remaining errors keep suggestions: [] — they're still flagged.
    const deadline = Date.now() + SUGGEST_BUDGET_MS;
    for (const err of misspelled) {
      if (Date.now() >= deadline) break;
      err.suggestions = dict.suggest(err.text).slice(0, 5);
    }

    return misspelled;
  }
}
