export function transliterationForLanguage(
  transliterations: Record<string, string> | null | undefined,
  sourceLanguage: string | null | undefined,
  preferredReaderLanguages: string[] = [],
): string | null {
  if (!transliterations || !sourceLanguage) return null;

  for (const readerLanguage of preferredReaderLanguages) {
    const preferred = transliterations[`${sourceLanguage}→${readerLanguage}`]?.trim();
    if (preferred) return preferred;
  }

  const prefix = `${sourceLanguage}→`;
  for (const [key, value] of Object.entries(transliterations)) {
    if (key.startsWith(prefix) && value.trim()) return value.trim();
  }

  return null;
}
