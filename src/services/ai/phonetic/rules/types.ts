/**
 * A rule maps a grapheme pattern (string or regex) to an IPA output.
 * Rules are applied in order; longer/more-specific patterns should come first.
 */
export interface IpaRule {
  /** Grapheme pattern — matched case-insensitively against the input */
  pattern: string;
  /** IPA output */
  ipa: string;
}

/** A complete rule set for one language */
export interface IpaRuleSet {
  /** ISO 639-1 language code */
  language: string;
  /** Rules applied in order, longest match first */
  rules: IpaRule[];
}
