export const LANGUAGES: Record<string, { name: string; flag: string }> = {
  en: { name: "English", flag: "\u{1F1EC}\u{1F1E7}" },
  fr: { name: "French", flag: "\u{1F1EB}\u{1F1F7}" },
  es: { name: "Spanish", flag: "\u{1F1EA}\u{1F1F8}" },
  de: { name: "German", flag: "\u{1F1E9}\u{1F1EA}" },
  hu: { name: "Hungarian", flag: "\u{1F1ED}\u{1F1FA}" },
  it: { name: "Italian", flag: "\u{1F1EE}\u{1F1F9}" },
  pt: { name: "Portuguese", flag: "\u{1F1F5}\u{1F1F9}" },
  nl: { name: "Dutch", flag: "\u{1F1F3}\u{1F1F1}" },
  ru: { name: "Russian", flag: "\u{1F1F7}\u{1F1FA}" },
  zh: { name: "Chinese", flag: "\u{1F1E8}\u{1F1F3}" },
  ja: { name: "Japanese", flag: "\u{1F1EF}\u{1F1F5}" },
  ko: { name: "Korean", flag: "\u{1F1F0}\u{1F1F7}" },
  ar: { name: "Arabic", flag: "\u{1F1F8}\u{1F1E6}" },
  he: { name: "Hebrew", flag: "\u{1F1EE}\u{1F1F1}" },
  tr: { name: "Turkish", flag: "\u{1F1F9}\u{1F1F7}" },
  da: { name: "Danish", flag: "\u{1F1E9}\u{1F1F0}" },
  pl: { name: "Polish", flag: "\u{1F1F5}\u{1F1F1}" },
};

/** Short label for UI: "🇫🇷 fr" */
export function langTag(code: string): string {
  const l = LANGUAGES[code];
  return l ? `${l.flag} ${code}` : code.toUpperCase();
}

/** Full name: "French" */
export function langName(code: string): string {
  return LANGUAGES[code]?.name ?? code.toUpperCase();
}

/** For select menus: "🇫🇷 fr — French" */
export function langOption(code: string): string {
  const l = LANGUAGES[code];
  return l ? `${l.flag} ${code} — ${l.name}` : code.toUpperCase();
}
