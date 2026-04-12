import type { PhoneticProvider } from "./provider.ts";
import { ipaRuleSets } from "./rules/index.ts";
import type { IpaRuleSet } from "./rules/index.ts";

/**
 * Deterministic rule-based IPA transcription for languages with regular
 * orthographies (Spanish, Italian, German, Turkish, etc.).
 *
 * Zero cost, instant, no API calls. Rules are applied greedily
 * (longest match first) left to right across the input text.
 */
export class RuleBasedIpaProvider implements PhoneticProvider {
  readonly system = "ipa";

  /** Sorted rules cache — pre-sorted by pattern length descending per language */
  private sortedRules = new Map<string, IpaRuleSet>();

  supports(language: string): boolean {
    return language in ipaRuleSets;
  }

  async transcribe(texts: string[], language: string): Promise<string[]> {
    const ruleSet = this.getRuleSet(language);
    if (!ruleSet) {
      throw new Error(`No rule-based IPA rules for language: ${language}`);
    }
    return texts.map((text) => this.transcribeOne(text, ruleSet));
  }

  private getRuleSet(language: string): IpaRuleSet | null {
    if (this.sortedRules.has(language)) {
      return this.sortedRules.get(language)!;
    }

    const original = ipaRuleSets[language];
    if (!original) return null;

    // Sort rules by pattern length descending for greedy longest-match
    const sorted: IpaRuleSet = {
      language: original.language,
      rules: [...original.rules].sort(
        (a, b) => b.pattern.length - a.pattern.length,
      ),
    };
    this.sortedRules.set(language, sorted);
    return sorted;
  }

  private transcribeOne(text: string, ruleSet: IpaRuleSet): string {
    const lower = text.toLowerCase();
    let result = "";
    let i = 0;

    while (i < lower.length) {
      let matched = false;

      for (const rule of ruleSet.rules) {
        if (lower.startsWith(rule.pattern, i)) {
          result += rule.ipa;
          i += rule.pattern.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Pass through spaces, punctuation, numbers as-is
        result += lower[i];
        i++;
      }
    }

    return `/${result}/`;
  }
}
