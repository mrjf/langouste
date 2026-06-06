import { baseLanguage, targetIs } from "../language";
import { normalizeIpaOutput, wrapIpa } from "../ipa";
import { ipaRuleSets, type IpaRuleSet } from "../rules";
import type { LitProvider, LitResult, NormalizedLitRequest } from "../types";

export class RuleIpaProvider implements LitProvider {
  readonly id = "rule-ipa";
  private readonly sortedRules = new Map<string, IpaRuleSet>();

  supports(request: NormalizedLitRequest): boolean {
    return targetIs(request, ["ipa"]) && baseLanguage(request.to.language) in ipaRuleSets;
  }

  async transliterate(
    texts: string[],
    request: NormalizedLitRequest,
  ): Promise<LitResult[]> {
    const language = baseLanguage(request.to.language);
    const ruleSet = this.ruleSet(language);
    if (!ruleSet) {
      throw new Error(`No IPA rules for language: ${language}`);
    }
    return texts.map((text) => ({
      text: wrapIpa(this.transcribeOne(text, ruleSet, language)),
      from: request.from,
      to: request.to,
      provider: this.id,
      deterministic: true,
      confidence: 0.65,
    }));
  }

  private ruleSet(language: string): IpaRuleSet | null {
    const cached = this.sortedRules.get(language);
    if (cached) return cached;
    const original = ipaRuleSets[language];
    if (!original) return null;
    const sorted: IpaRuleSet = {
      language: original.language,
      ...(original.stress ? { stress: original.stress } : {}),
      rules: [...original.rules].sort((left, right) => right.pattern.length - left.pattern.length),
    };
    this.sortedRules.set(language, sorted);
    return sorted;
  }

  private transcribeOne(text: string, ruleSet: IpaRuleSet, language: string): string {
    const lower = text.toLocaleLowerCase(language);
    let result = "";
    let index = 0;

    while (index < lower.length) {
      let matched = false;
      for (const rule of ruleSet.rules) {
        if (lower.startsWith(rule.pattern, index)) {
          result += rule.ipa;
          index += rule.pattern.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        result += lower[index] ?? "";
        index += 1;
      }
    }

    const normalized = normalizeIpaOutput(result);
    return ruleSet.stress === "initial" ? markInitialStress(normalized) : normalized;
  }
}

function markInitialStress(value: string): string {
  return value.replace(
    /(^|[\s([{"“‘„«])(\p{Letter}[^\s()[\]{}/.,;:!?'"“”‘’„«»]*)/gu,
    "$1ˈ$2",
  );
}
