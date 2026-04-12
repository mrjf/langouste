import type { LanguageCode, TextError } from "../../types/index.ts";
import type { SpellCheckProvider } from "./provider.ts";

/**
 * No-op spell check provider — always returns no errors.
 * Use this when relying solely on LLM for error detection.
 */
export class NoopProvider implements SpellCheckProvider {
  readonly name = "noop";

  supportsLanguage(_lang: LanguageCode): boolean {
    return true;
  }

  async check(_text: string, _language: LanguageCode): Promise<TextError[]> {
    return [];
  }
}
