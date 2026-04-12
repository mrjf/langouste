import type { IpaRuleSet } from "./types.ts";

/**
 * Italian grapheme-to-IPA rules.
 * Italian has very regular orthography.
 */
export const italianRules: IpaRuleSet = {
  language: "it",
  rules: [
    // Multi-character patterns (longest match first)
    { pattern: "gli", ipa: "ʎi" },
    { pattern: "gn", ipa: "ɲ" },
    { pattern: "sch", ipa: "sk" },
    { pattern: "sci", ipa: "ʃi" },
    { pattern: "sce", ipa: "ʃe" },
    { pattern: "sc", ipa: "sk" },
    { pattern: "chi", ipa: "ki" },
    { pattern: "che", ipa: "ke" },
    { pattern: "ch", ipa: "k" },
    { pattern: "ghi", ipa: "ɡi" },
    { pattern: "ghe", ipa: "ɡe" },
    { pattern: "gh", ipa: "ɡ" },
    { pattern: "ci", ipa: "tʃi" },
    { pattern: "ce", ipa: "tʃe" },
    { pattern: "gi", ipa: "dʒi" },
    { pattern: "ge", ipa: "dʒe" },
    { pattern: "zz", ipa: "tts" },
    { pattern: "ss", ipa: "ss" },
    { pattern: "rr", ipa: "rr" },
    { pattern: "ll", ipa: "ll" },
    { pattern: "cc", ipa: "kk" },
    { pattern: "tt", ipa: "tt" },
    { pattern: "pp", ipa: "pp" },
    { pattern: "mm", ipa: "mm" },
    { pattern: "nn", ipa: "nn" },
    { pattern: "bb", ipa: "bb" },
    { pattern: "dd", ipa: "dd" },
    { pattern: "ff", ipa: "ff" },
    { pattern: "gg", ipa: "ɡɡ" },

    // Accented vowels
    { pattern: "à", ipa: "a" },
    { pattern: "è", ipa: "ɛ" },
    { pattern: "é", ipa: "e" },
    { pattern: "ì", ipa: "i" },
    { pattern: "ò", ipa: "ɔ" },
    { pattern: "ó", ipa: "o" },
    { pattern: "ù", ipa: "u" },

    // Vowels
    { pattern: "a", ipa: "a" },
    { pattern: "e", ipa: "e" },
    { pattern: "i", ipa: "i" },
    { pattern: "o", ipa: "o" },
    { pattern: "u", ipa: "u" },

    // Consonants
    { pattern: "b", ipa: "b" },
    { pattern: "c", ipa: "k" },
    { pattern: "d", ipa: "d" },
    { pattern: "f", ipa: "f" },
    { pattern: "g", ipa: "ɡ" },
    { pattern: "h", ipa: "" }, // silent
    { pattern: "j", ipa: "j" },
    { pattern: "k", ipa: "k" },
    { pattern: "l", ipa: "l" },
    { pattern: "m", ipa: "m" },
    { pattern: "n", ipa: "n" },
    { pattern: "p", ipa: "p" },
    { pattern: "q", ipa: "k" },
    { pattern: "r", ipa: "r" },
    { pattern: "s", ipa: "s" },
    { pattern: "t", ipa: "t" },
    { pattern: "v", ipa: "v" },
    { pattern: "w", ipa: "w" },
    { pattern: "x", ipa: "ks" },
    { pattern: "y", ipa: "i" },
    { pattern: "z", ipa: "ts" },
  ],
};
