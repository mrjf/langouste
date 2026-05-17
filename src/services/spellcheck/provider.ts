import type { LanguageCode, TextError } from "../../types/index.ts";

/**
 * Abstract interface for spell-check providers.
 *
 * This is the seam for the planned architecture: separate spelling
 * SERVICES, one per language, called out-of-process (HTTP/RPC) or
 * off-thread (Worker). `check()` is async precisely so an implementation
 * can `await fetch(...)` a remote per-language service with no change to
 * callers — everything goes through checkSpelling() in checker.ts, and the
 * provider is selected by SPELLCHECK_PROVIDER.
 *
 * Implementations check text in a given language and return errors with
 * character offsets + suggestions.
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
