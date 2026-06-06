import { baseLanguage } from "./language";

const PIPER_REVERSE_PUA: Record<string, string> = {
  "\uE01D": "r",
  "\uE01E": "y",
  "\uE020": "pʰ",
  "\uE021": "tʰ",
  "\uE022": "kʰ",
  "\uE023": "tɕ",
  "\uE024": "tɕʰ",
  "\uE025": "tʂ",
  "\uE026": "tʂʰ",
  "\uE027": "tsʰ",
  "\uE028": "aɪ",
  "\uE029": "eɪ",
  "\uE02A": "aʊ",
  "\uE02B": "oʊ",
  "\uE02C": "an",
  "\uE02D": "ən",
  "\uE02E": "aŋ",
  "\uE02F": "əŋ",
  "\uE030": "uŋ",
  "\uE031": "ia",
  "\uE032": "iɛ",
  "\uE033": "iou",
  "\uE034": "iaʊ",
  "\uE035": "iɛn",
  "\uE036": "in",
  "\uE037": "iaŋ",
  "\uE038": "iŋ",
  "\uE039": "iuŋ",
  "\uE03A": "ua",
  "\uE03B": "uo",
  "\uE03C": "uaɪ",
  "\uE03D": "ueɪ",
  "\uE03E": "uan",
  "\uE03F": "uən",
  "\uE040": "uaŋ",
  "\uE041": "uəŋ",
  "\uE042": "yɛ",
  "\uE043": "yɛn",
  "\uE044": "yn",
  "\uE045": "ɻ̩",
  "\uE046": "˥",
  "\uE047": "˧˥",
  "\uE048": "˧˩˧",
  "\uE049": "˥˩",
  "\uE04A": "˧",
  "\uE04B": "p͈",
  "\uE04C": "t͈",
  "\uE04D": "k͈",
  "\uE04E": "s͈",
  "\uE04F": "t͈ɕ",
  "\uE050": "k̚",
  "\uE051": "t̚",
  "\uE052": "p̚",
  "\uE054": "tʃ",
  "\uE055": "dʒ",
  "\uE056": "ɛ̃",
  "\uE057": "ɑ̃",
  "\uE058": "ɔ̃",
  "\uE059": "iː",
  "\uE05A": "yː",
  "\uE05B": "eː",
  "\uE05C": "ɛː",
  "\uE05D": "øː",
  "\uE05E": "ɑː",
  "\uE05F": "oː",
  "\uE060": "uː",
  "\uE061": "ʉː",
};

const IPA_PASSTHROUGH_RE = /^[\p{Letter}\p{Mark}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;

export function normalizeIpaOutput(value: string): string {
  let normalized = "";
  for (const char of value) {
    normalized += PIPER_REVERSE_PUA[char] ?? char;
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

export function wrapIpa(value: string): string {
  const clean = normalizeIpaOutput(value);
  if (!clean) return "";
  if (/^\/.*\/$/u.test(clean) || /^\[.*\]$/u.test(clean)) return clean;
  return `/${clean}/`;
}

export function isProbablyUsefulIpa(source: string, ipa: string, language: string): boolean {
  const clean = normalizeIpaOutput(ipa);
  if (!clean || !IPA_PASSTHROUGH_RE.test(clean)) return false;
  const sourceComparable = source.replace(/\s+/gu, " ").trim().toLocaleLowerCase(baseLanguage(language));
  const ipaComparable = clean.replace(/[/.ˈˌ\s]+/gu, "").toLocaleLowerCase(baseLanguage(language));
  if (!ipaComparable) return false;
  return ipaComparable !== sourceComparable.replace(/\s+/gu, "");
}
