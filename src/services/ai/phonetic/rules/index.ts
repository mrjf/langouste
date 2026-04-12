import type { IpaRuleSet } from "./types.ts";
import { spanishRules } from "./es.ts";
import { germanRules } from "./de.ts";
import { italianRules } from "./it.ts";
import { turkishRules } from "./tr.ts";

export type { IpaRule, IpaRuleSet } from "./types.ts";

/** All available rule-based IPA rule sets, keyed by language code. */
export const ipaRuleSets: Record<string, IpaRuleSet> = {
  es: spanishRules,
  de: germanRules,
  it: italianRules,
  tr: turkishRules,
};
