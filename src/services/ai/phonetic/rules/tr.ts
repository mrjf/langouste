import type { IpaRuleSet } from "./types.ts";

/**
 * Turkish grapheme-to-IPA rules.
 * Turkish has extremely regular orthography — nearly perfect 1:1 mapping.
 */
export const turkishRules: IpaRuleSet = {
  language: "tr",
  rules: [
    // Vowels
    { pattern: "â", ipa: "aː" },
    { pattern: "a", ipa: "a" },
    { pattern: "e", ipa: "e" },
    { pattern: "ı", ipa: "ɯ" },
    { pattern: "i", ipa: "i" },
    { pattern: "î", ipa: "iː" },
    { pattern: "o", ipa: "o" },
    { pattern: "ö", ipa: "ø" },
    { pattern: "u", ipa: "u" },
    { pattern: "ü", ipa: "y" },
    { pattern: "û", ipa: "uː" },

    // Consonants
    { pattern: "b", ipa: "b" },
    { pattern: "c", ipa: "dʒ" },
    { pattern: "ç", ipa: "tʃ" },
    { pattern: "d", ipa: "d" },
    { pattern: "f", ipa: "f" },
    { pattern: "g", ipa: "ɡ" },
    { pattern: "ğ", ipa: "" }, // lengthens preceding vowel
    { pattern: "h", ipa: "h" },
    { pattern: "j", ipa: "ʒ" },
    { pattern: "k", ipa: "k" },
    { pattern: "l", ipa: "l" },
    { pattern: "m", ipa: "m" },
    { pattern: "n", ipa: "n" },
    { pattern: "p", ipa: "p" },
    { pattern: "r", ipa: "ɾ" },
    { pattern: "s", ipa: "s" },
    { pattern: "ş", ipa: "ʃ" },
    { pattern: "t", ipa: "t" },
    { pattern: "v", ipa: "v" },
    { pattern: "y", ipa: "j" },
    { pattern: "z", ipa: "z" },
  ],
};
