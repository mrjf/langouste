/**
 * Abstract interface for translation providers.
 * Implementations translate batches of text into a target language.
 */
export interface TranslationProvider {
  /**
   * Translate a batch of texts into the target language.
   * Returns translations in the same order as the input.
   * @param context Optional hint about what these texts are (e.g. "casual chat messages between friends")
   */
  translateTexts(texts: string[], targetLanguage: string, context?: string): Promise<string[]>;
}
