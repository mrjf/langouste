import type { LanguageCode, TextError } from "../../types/index.ts";

/**
 * Abstract interface for spell-check providers.
 * Implementations check text in a given language and return errors with positions.
 */
export interface SpellCheckProvider {
  /** Human-readable name for logging */
  readonly name: string;

  /** Whether this provider supports a given language */
  supportsLanguage(lang: LanguageCode): boolean;

  /**
   * Check text for spelling errors.
   * Returns TextError[] with character offsets and suggestions.
   */
  check(text: string, language: LanguageCode): Promise<TextError[]>;
}
