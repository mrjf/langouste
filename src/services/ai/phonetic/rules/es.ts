import type { IpaRuleSet } from "./types.ts";

/**
 * Spanish (Castilian) grapheme-to-IPA rules.
 * Spanish has highly regular orthography — nearly 1:1 spelling→pronunciation.
 */
export const spanishRules: IpaRuleSet = {
  language: "es",
  rules: [
    // Multi-character patterns first (longest match)
    { pattern: "ch", ipa: "tʃ" },
    { pattern: "ll", ipa: "ʝ" },
    { pattern: "rr", ipa: "r" },
    { pattern: "qu", ipa: "k" },
    { pattern: "gu", ipa: "ɡ" },
    { pattern: "ñ", ipa: "ɲ" },

    // Vowels
    { pattern: "á", ipa: "a" },
    { pattern: "é", ipa: "e" },
    { pattern: "í", ipa: "i" },
    { pattern: "ó", ipa: "o" },
    { pattern: "ú", ipa: "u" },
    { pattern: "ü", ipa: "u" },
    { pattern: "a", ipa: "a" },
    { pattern: "e", ipa: "e" },
    { pattern: "i", ipa: "i" },
    { pattern: "o", ipa: "o" },
    { pattern: "u", ipa: "u" },

    // Consonants
    { pattern: "b", ipa: "b" },
    { pattern: "c", ipa: "k" }, // simplified: before e/i → θ (Castilian) or s (Latin American)
    { pattern: "d", ipa: "d" },
    { pattern: "f", ipa: "f" },
    { pattern: "g", ipa: "ɡ" },
    { pattern: "h", ipa: "" }, // silent
    { pattern: "j", ipa: "x" },
    { pattern: "k", ipa: "k" },
    { pattern: "l", ipa: "l" },
    { pattern: "m", ipa: "m" },
    { pattern: "n", ipa: "n" },
    { pattern: "p", ipa: "p" },
    { pattern: "r", ipa: "ɾ" },
    { pattern: "s", ipa: "s" },
    { pattern: "t", ipa: "t" },
    { pattern: "v", ipa: "b" },
    { pattern: "w", ipa: "w" },
    { pattern: "x", ipa: "ks" },
    { pattern: "y", ipa: "ʝ" },
    { pattern: "z", ipa: "s" }, // Latin American; Castilian would be θ
  ],
};
