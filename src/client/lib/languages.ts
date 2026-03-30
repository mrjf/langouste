export const LANGUAGES: Record<string, string> = {
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

export function langName(code: string): string {
  return LANGUAGES[code] ?? code.toUpperCase();
}
