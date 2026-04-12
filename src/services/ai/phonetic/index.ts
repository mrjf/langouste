import type { PhoneticProvider } from "./provider.ts";
import { RuleBasedIpaProvider } from "./rule-based-provider.ts";
import { GoogleIpaProvider } from "./google-ipa-provider.ts";

export type { PhoneticProvider } from "./provider.ts";
export { RuleBasedIpaProvider } from "./rule-based-provider.ts";
export { GoogleIpaProvider } from "./google-ipa-provider.ts";

/**
 * Registry of phonetic providers, keyed by system name.
 * Each system (e.g., "ipa") can have multiple providers checked in order;
 * the first one that supports the language wins.
 *
 * For IPA, the chain is:
 *   1. RuleBasedIpaProvider — free, instant, for phonetic orthographies (es, de, it, tr)
 *   2. GoogleIpaProvider (Gemini) — fallback for irregular languages (en, fr, zh, ja, etc.)
 */
const registry = new Map<string, PhoneticProvider[]>();
const fallbacks = new Map<string, () => PhoneticProvider>();

// Rule-based provider handles languages it has rules for, others fall through
registry.set("ipa", [new RuleBasedIpaProvider()]);

// LLM fallback for languages without deterministic rules
fallbacks.set("ipa", () => new GoogleIpaProvider());

export function registerPhoneticProvider(provider: PhoneticProvider): void {
  const list = registry.get(provider.system) ?? [];
  list.unshift(provider); // highest priority first
  registry.set(provider.system, list);
}

/**
 * Get a phonetic provider for a given system and language.
 * Returns null if no provider supports the combination.
 */
export function getPhoneticProvider(
  system: string,
  language: string,
): PhoneticProvider | null {
  // Check registered providers first
  const list = registry.get(system);
  if (list) {
    for (const provider of list) {
      if (provider.supports(language)) {
        return provider;
      }
    }
  }

  // Fall back to default factory
  const factory = fallbacks.get(system);
  if (factory) {
    const fallback = factory();
    if (fallback.supports(language)) {
      return fallback;
    }
  }

  return null;
}

/**
 * Register a default factory for a phonetic system.
 * The factory is called lazily when no registered provider matches.
 */
export function registerPhoneticFallback(
  system: string,
  factory: () => PhoneticProvider,
): void {
  fallbacks.set(system, factory);
}
