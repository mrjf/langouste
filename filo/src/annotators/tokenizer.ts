import type { FiloDocument } from "../document";
import type { FiloAnnotation, TokenPayload, WordPayload } from "../types";

const TOKEN_PATTERN = /[\p{Letter}\p{Mark}\p{Number}]+(?:[’'_.-][\p{Letter}\p{Mark}\p{Number}]+)*|[^\s]/gu;
const WORD_PATTERN = /^[\p{Letter}\p{Mark}\p{Number}]/u;

export interface TokenizerOptions {
  language?: string;
  tierId?: string;
  source?: string;
}

export function annotateTokens(
  document: FiloDocument,
  options: TokenizerOptions = {},
): Array<FiloAnnotation<TokenPayload>> {
  const tierId = options.tierId ?? "token";
  document.ensureTier<TokenPayload>({
    id: tierId,
    kind: "token",
    description: "Unicode token boundaries",
    source: options.source ?? "filo.tokenizer",
  });

  const annotations: Array<FiloAnnotation<TokenPayload>> = [];
  let ordinal = 0;
  for (const match of document.text.matchAll(TOKEN_PATTERN)) {
    const surface = match[0];
    const startStringIndex = match.index ?? 0;
    const endStringIndex = startStringIndex + surface.length;
    const range = document.byteRangeForStringIndices(startStringIndex, endStringIndex);
    const payload: TokenPayload = {
      surface,
      normalized: normalizeSurface(surface, options.language),
      ordinal,
      tokenType: tokenType(surface),
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    annotations.push(
      document.addAnnotation<TokenPayload>(tierId, {
        ...range,
        payload,
      }),
    );
    ordinal += 1;
  }
  return annotations;
}

export function annotateWords(
  document: FiloDocument,
  options: TokenizerOptions = {},
): Array<FiloAnnotation<WordPayload>> {
  const tierId = options.tierId ?? "word";
  document.ensureTier<WordPayload>({
    id: tierId,
    kind: "word",
    description: "Unicode word boundaries",
    source: options.source ?? "filo.tokenizer",
  });

  const annotations: Array<FiloAnnotation<WordPayload>> = [];
  let ordinal = 0;
  for (const match of document.text.matchAll(TOKEN_PATTERN)) {
    const surface = match[0];
    if (!WORD_PATTERN.test(surface)) continue;
    const startStringIndex = match.index ?? 0;
    const endStringIndex = startStringIndex + surface.length;
    const range = document.byteRangeForStringIndices(startStringIndex, endStringIndex);
    const payload: WordPayload = {
      surface,
      normalized: normalizeSurface(surface, options.language),
      ordinal,
      ...(options.language !== undefined ? { language: options.language } : {}),
    };
    annotations.push(
      document.addAnnotation<WordPayload>(tierId, {
        ...range,
        payload,
      }),
    );
    ordinal += 1;
  }
  return annotations;
}

function normalizeSurface(surface: string, language: string | undefined): string {
  return language ? surface.toLocaleLowerCase(language) : surface.toLocaleLowerCase();
}

function tokenType(surface: string): TokenPayload["tokenType"] {
  if (WORD_PATTERN.test(surface)) return "word";
  if (/^\p{Punctuation}$/u.test(surface)) return "punctuation";
  return "symbol";
}
