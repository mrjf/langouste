import type { LanguageCode, TextError } from "../../types/index.ts";
import type { SpellCheckProvider } from "./provider.ts";
import { NoopProvider } from "./noop-provider.ts";
import { LanguageToolProvider } from "./languagetool-provider.ts";
import { NspellProvider } from "./nspell-provider.ts";

export type { SpellCheckProvider } from "./provider.ts";
export { NoopProvider } from "./noop-provider.ts";
export { LanguageToolProvider } from "./languagetool-provider.ts";
export { NspellProvider } from "./nspell-provider.ts";

function createProvider(): SpellCheckProvider {
  const setting = process.env.SPELLCHECK_PROVIDER ?? "noop";
  switch (setting) {
    case "languagetool": return new LanguageToolProvider();
    case "nspell": return new NspellProvider();
    case "noop": return new NoopProvider();
    default:
      console.warn(`[SpellCheck] Unknown provider "${setting}", using noop`);
      return new NoopProvider();
  }
}

let _provider: SpellCheckProvider = createProvider();
console.log(`[SpellCheck] Provider: ${_provider.name}`);

/** Replace the spell-check provider */
export function setSpellCheckProvider(provider: SpellCheckProvider) {
  _provider = provider;
}

/** Get the current spell-check provider */
export function getSpellCheckProvider(): SpellCheckProvider {
  return _provider;
}

/**
 * Run spell-checking on text using the active provider.
 * Returns empty array if provider doesn't support the language.
 */
export async function checkSpelling(
  text: string,
  language: LanguageCode,
): Promise<TextError[]> {
  if (!_provider.supportsLanguage(language)) return [];
  return _provider.check(text, language);
}
