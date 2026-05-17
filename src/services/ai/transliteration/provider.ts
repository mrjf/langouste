/**
 * A transliteration provider converts text from one script to another.
 *
 * Transliteration is script-pair-specific: Arabic→Latin for English readers
 * differs from Arabic→Latin for French readers (e.g., "ش" → "sh" vs "ch").
 * Providers handle a specific source→target script pair.
 */
export interface TransliterationProvider {
  /**
   * Transliterate a batch of texts.
   * @param texts - Texts in the source script
   * @param sourceLang - Language code of the source text (e.g., "ar", "zh", "ja")
   * @param targetLang - Language code of the reader (e.g., "en", "fr") — determines
   *                     romanization conventions
   * @returns Transliterated texts in the same order
   */
  transliterate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]>;

  /**
   * Whether this provider can handle the given language pair.
   */
  supports(sourceLang: string, targetLang: string): boolean;
}
