/**
 * A phonetic provider generates phonetic representations of text.
 *
 * Different phonetic systems exist (IPA, X-SAMPA, Pinyin, etc.).
 * Each provider handles a specific system and is identified by a system key
 * (e.g., "ipa", "xsampa", "pinyin") used as part of the storage key.
 */
export interface PhoneticProvider {
  /**
   * The phonetic system this provider generates (e.g., "ipa", "xsampa", "pinyin").
   * Used as a namespace in storage keys.
   */
  readonly system: string;

  /**
   * Generate phonetic representations for a batch of texts.
   * @param texts - Texts to transcribe
   * @param language - Language code of the texts (e.g., "fr", "ja")
   * @returns Phonetic representations in the same order
   */
  transcribe(texts: string[], language: string): Promise<string[]>;

  /**
   * Whether this provider can handle the given language.
   */
  supports(language: string): boolean;
}
