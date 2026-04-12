/** ISO 639-1 code → full English name */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  hu: "Hungarian",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  tr: "Turkish",
  pl: "Polish",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}
