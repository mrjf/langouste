import type { LanguageCode, TextError } from "../../types/index.ts";
import { config } from "../../lib/config.ts";
import type { SpellCheckProvider } from "./provider.ts";
import { NoopProvider } from "./noop-provider.ts";
import { LanguageToolProvider } from "./languagetool-provider.ts";
import { NspellProvider } from "./nspell-provider.ts";

export type { SpellCheckProvider } from "./provider.ts";
export { NoopProvider } from "./noop-provider.ts";
export { LanguageToolProvider } from "./languagetool-provider.ts";
export { NspellProvider } from "./nspell-provider.ts";

// Spell-check is an async, swappable boundary (SpellCheckProvider). The
// long-term plan is a separate per-language spelling SERVICE called over an
// API / off-thread — implement SpellCheckProvider (its check() is already
// async) and select it here; no caller changes. checkSpelling() is the
// single entry point everything goes through.
//
// Default is "noop" (no deterministic spell-check; Opus still explains
// spelling+grammar on every message). The bundled in-process "nspell"
// provider is intentionally NOT the default: nspell's dictionary init is
// synchronous and pathologically slow for several languages (es ~0.4s,
// fr ~1.8s, pl ~4.8s, pt ~7.9s, Hungarian = minutes), which blocks the
// server's event loop. It remains selectable for experimentation only.
function createProvider(): SpellCheckProvider {
  const setting = config.spellcheckProvider;
  switch (setting) {
    case "languagetool":
      return new LanguageToolProvider();
    case "nspell":
      console.warn(
        "[SpellCheck] nspell selected — its dictionary init is synchronous " +
          "and blocks the event loop (minutes for some languages). " +
          "Not for production.",
      );
      return new NspellProvider();
    case "noop":
      return new NoopProvider();
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
export async function checkSpelling(text: string, language: LanguageCode): Promise<TextError[]> {
  if (!_provider.supportsLanguage(language)) return [];
  return _provider.check(text, language);
}
