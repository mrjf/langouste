const LATIN_SCRIPT = "Latn";

/**
 * Whether a language normally uses a non-Latin writing system.
 *
 * Intl.Locale gives us CLDR's likely script for arbitrary BCP 47 language
 * tags, so this also covers languages that are not listed in the app's
 * language picker yet. Explicit script subtags remain authoritative:
 * `sr-Latn` is false while `sr-Cyrl` is true.
 */
export function languageUsesNonLatinScript(language: string | null | undefined): boolean {
  const tag = language?.trim();
  if (!tag) return false;

  try {
    const script = new Intl.Locale(tag).maximize().script;
    return !!script && script !== LATIN_SCRIPT;
  } catch {
    return false;
  }
}

/** Detect non-Latin letters in text without treating punctuation or emoji as script. */
export function containsNonLatinLetters(text: string | null | undefined): boolean {
  if (!text) return false;
  const letters = text.match(/\p{Letter}/gu) ?? [];
  return letters.some((letter) => !/\p{Script=Latin}/u.test(letter));
}
