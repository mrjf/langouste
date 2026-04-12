import type { IpaRuleSet } from "./types.ts";

/**
 * German grapheme-to-IPA rules.
 * German orthography is largely regular with some digraph conventions.
 */
export const germanRules: IpaRuleSet = {
  language: "de",
  rules: [
    // Multi-character patterns (longest match first)
    { pattern: "sch", ipa: "ʃ" },
    { pattern: "tsch", ipa: "tʃ" },
    { pattern: "ch", ipa: "ç" }, // simplified: ç after front vowels, x after back vowels
    { pattern: "ck", ipa: "k" },
    { pattern: "ph", ipa: "f" },
    { pattern: "th", ipa: "t" },
    { pattern: "sp", ipa: "ʃp" }, // word-initial
    { pattern: "st", ipa: "ʃt" }, // word-initial
    { pattern: "ei", ipa: "aɪ" },
    { pattern: "ie", ipa: "iː" },
    { pattern: "eu", ipa: "ɔʏ" },
    { pattern: "äu", ipa: "ɔʏ" },
    { pattern: "au", ipa: "aʊ" },

    // Umlauts and long vowels
    { pattern: "ä", ipa: "ɛ" },
    { pattern: "ö", ipa: "ø" },
    { pattern: "ü", ipa: "yː" },
    { pattern: "ß", ipa: "s" },
    { pattern: "aa", ipa: "aː" },
    { pattern: "ee", ipa: "eː" },
    { pattern: "oo", ipa: "oː" },

    // Vowels
    { pattern: "a", ipa: "a" },
    { pattern: "e", ipa: "ə" },
    { pattern: "i", ipa: "ɪ" },
    { pattern: "o", ipa: "ɔ" },
    { pattern: "u", ipa: "ʊ" },
    { pattern: "y", ipa: "ʏ" },

    // Consonants
    { pattern: "b", ipa: "b" },
    { pattern: "c", ipa: "k" },
    { pattern: "d", ipa: "d" },
    { pattern: "f", ipa: "f" },
    { pattern: "g", ipa: "ɡ" },
    { pattern: "h", ipa: "h" },
    { pattern: "j", ipa: "j" },
    { pattern: "k", ipa: "k" },
    { pattern: "l", ipa: "l" },
    { pattern: "m", ipa: "m" },
    { pattern: "n", ipa: "n" },
    { pattern: "p", ipa: "p" },
    { pattern: "qu", ipa: "kv" },
    { pattern: "r", ipa: "ʁ" },
    { pattern: "s", ipa: "z" }, // simplified: z word-initially, s otherwise
    { pattern: "t", ipa: "t" },
    { pattern: "v", ipa: "f" },
    { pattern: "w", ipa: "v" },
    { pattern: "x", ipa: "ks" },
    { pattern: "z", ipa: "ts" },
  ],
};
