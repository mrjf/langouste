import { detect } from "tinyld";
import type { LanguageCode } from "../../types/index.ts";

/**
 * Detect the language of text, restricted to a set of candidate languages.
 * Returns the best-matching candidate, or the first candidate if detection fails.
 */
export function detectLanguage(
  text: string,
  candidates: LanguageCode[],
): LanguageCode {
  if (candidates.length === 0) return "en";
  if (candidates.length === 1) return candidates[0];

  const detected = detect(text);
  if (detected && candidates.includes(detected as LanguageCode)) {
    return detected as LanguageCode;
  }

  // Fallback: return first candidate
  return candidates[0];
}
