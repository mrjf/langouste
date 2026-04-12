import type { TransliterationProvider } from "./provider.ts";
import { DefaultTransliterationProvider } from "./default-provider.ts";

export type { TransliterationProvider } from "./provider.ts";
export { DefaultTransliterationProvider } from "./default-provider.ts";

/**
 * Registry of transliteration providers, checked in order.
 * More specific providers (e.g., a dedicated pinyin or kuroshiro library)
 * can be registered to take priority over the default rule-based fallback.
 */
const providers: TransliterationProvider[] = [];
let _fallback: TransliterationProvider | null = null;

export function registerTransliterationProvider(
  provider: TransliterationProvider,
): void {
  providers.unshift(provider); // highest priority first
}

function getFallback(): TransliterationProvider {
  if (!_fallback) {
    _fallback = new DefaultTransliterationProvider();
  }
  return _fallback;
}

/**
 * Get the best transliteration provider for a given language pair.
 * Checks registered providers first, falls back to rule-based.
 */
export function getTransliterationProvider(
  sourceLang: string,
  targetLang: string,
): TransliterationProvider {
  for (const provider of providers) {
    if (provider.supports(sourceLang, targetLang)) {
      return provider;
    }
  }
  return getFallback();
}
