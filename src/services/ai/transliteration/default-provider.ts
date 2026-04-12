import { transliterate } from "transliteration";
import type { TransliterationProvider } from "./provider.ts";

/**
 * Deterministic rule-based transliteration using the `transliteration` package.
 * Zero cost, instant, handles most Unicode scripts → Latin.
 *
 * This is the general-purpose fallback. Language-specific providers
 * (e.g., pinyin for Chinese, kuroshiro for Japanese) can be registered
 * to take priority for higher-quality results.
 */
export class DefaultTransliterationProvider implements TransliterationProvider {
  supports(_sourceLang: string, _targetLang: string): boolean {
    return true;
  }

  async transliterate(
    texts: string[],
    _sourceLang: string,
    _targetLang: string,
  ): Promise<string[]> {
    return texts.map((text) => transliterate(text));
  }
}
