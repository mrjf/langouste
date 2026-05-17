export interface Token {
  word: string;
  start: number;
  end: number;
}

/**
 * Split text into word tokens with character offsets.
 * Splits on whitespace and punctuation boundaries.
 * Preserves hyphens within words (e.g. "est-ce", "peut-être").
 * Splits on apostrophes so each part is checked independently
 * (e.g. "l'homme" → "l", "homme"; "qu'est-ce" → "qu", "est-ce").
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Match word runs including accented chars and hyphens, plus apostrophe-joined groups
  const regex = /[\p{L}\p{M}]+(?:['-][\p{L}\p{M}]+)*/gu;
  for (const match of text.matchAll(regex)) {
    const full = match[0];
    const start = match.index;

    // Split on apostrophes (common in French: l', d', qu', j', n', s', c')
    // but keep hyphened compounds together (est-ce, peut-être)
    if (full.includes("'") || full.includes("\u2019")) {
      const parts = full.split(/['\u2019]/);
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
