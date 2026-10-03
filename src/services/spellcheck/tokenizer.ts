export interface Token {
  word: string;
  start: number;
  end: number;
}

/** Recognizes tokens produced by the URL branch of the tokenizer regex. */
export const URL_TOKEN_PATTERN = /^(?:https?:\/\/|www\.)/i;

// Trailing characters that are more likely sentence punctuation than part of
// the URL itself, e.g. "see http://example.com." or "(http://example.com)".
const URL_TRAILING_PUNCTUATION = /[.,;:!?)\]"'’]+$/;

/**
 * Split text into word tokens with character offsets.
 * Splits on whitespace and punctuation boundaries.
 * Preserves hyphens within words (e.g. "est-ce", "peut-être").
 * Splits on apostrophes so each part is checked independently
 * (e.g. "l'homme" → "l", "homme"; "qu'est-ce" → "qu", "est-ce").
 * URLs (http://, https://, www.) are kept as a single token instead of
 * being split at their internal punctuation.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Try a URL first at each position, otherwise fall back to word runs
  // (letters/marks, with hyphens and apostrophes joining parts).
  const regex = /(?:https?:\/\/|www\.)\S+|[\p{L}\p{M}]+(?:['-][\p{L}\p{M}]+)*/gu;
  for (const match of text.matchAll(regex)) {
    const full = match[0];
    const start = match.index;

    if (URL_TOKEN_PATTERN.test(full)) {
      const trimmed = full.replace(URL_TRAILING_PUNCTUATION, "");
      if (trimmed.length > 0) {
        tokens.push({ word: trimmed, start, end: start + trimmed.length });
      }
      continue;
    }

    // Split on apostrophes (common in French: l', d', qu', j', n', s', c')
    // but keep hyphened compounds together (est-ce, peut-être)
    if (full.includes("'") || full.includes("’")) {
      const parts = full.split(/['’]/);
      let offset = start;
      for (const part of parts) {
        if (part.length > 0) {
          tokens.push({ word: part, start: offset, end: offset + part.length });
        }
        offset += part.length + 1; // +1 for the apostrophe
      }
    } else {
      tokens.push({ word: full, start, end: start + full.length });
    }
  }
  return tokens;
}
