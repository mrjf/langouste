import type { PhoneticProvider } from "./provider.ts";
import { RuleBasedIpaProvider } from "./rule-based-provider.ts";

export type { PhoneticProvider } from "./provider.ts";
export { RuleBasedIpaProvider } from "./rule-based-provider.ts";

/**
 * Registry of phonetic providers, keyed by system name. Each system (e.g.,
 * "ipa") can have multiple providers checked in order; the first one that
 * supports the language wins.
 *
 * Policy: deterministic only. If no rule-based or dictionary-based provider
 * supports a (system, language) pair, we return null and the caller skips
 * phonetic generation. We do not fall back to an LLM.
 */
const registry = new Map<string, PhoneticProvider[]>();

registry.set("ipa", [new RuleBasedIpaProvider()]);

export function registerPhoneticProvider(provider: PhoneticProvider): void {
  const list = registry.get(provider.system) ?? [];
  list.unshift(provider); // highest priority first
  registry.set(provider.system, list);
}

/**
 * Get a phonetic provider for a given system and language.
 * Returns null if no deterministic provider supports the combination.
 */
export function getPhoneticProvider(
  system: string,
  language: string,
): PhoneticProvider | null {
  const list = registry.get(system);
  if (!list) return null;
  for (const provider of list) {
    if (provider.supports(language)) return provider;
  }
  return null;
}
