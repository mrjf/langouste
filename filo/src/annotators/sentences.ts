import type { FiloDocument } from "../document";
import type { FiloAnnotation, SentencePayload } from "../types";

export interface SentenceAnnotatorOptions {
  tierId?: string;
  language?: string;
  source?: string;
}

const TERMINATORS = new Set([".", "!", "?", "…", "。", "！", "？"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "}"]);

export function annotateSentences(
  document: FiloDocument,
  options: SentenceAnnotatorOptions = {},
): Array<FiloAnnotation<SentencePayload>> {
  const tierId = options.tierId ?? "sentence";
  document.ensureTier<SentencePayload>({
    id: tierId,
    kind: "sentence",
    description: "Sentence boundaries",
    source: options.source ?? "filo.sentences",
  });

  const annotations: Array<FiloAnnotation<SentencePayload>> = [];
  let cursor = 0;
  let ordinal = 0;

  while (cursor < document.text.length) {
    const start = nextNonWhitespace(document.text, cursor);
    if (start >= document.text.length) break;
    const end = sentenceEnd(document.text, start);
    const trimmedEnd = trimRight(document.text, end);
    if (trimmedEnd > start) {
      const range = document.byteRangeForStringIndices(start, trimmedEnd);
      const text = document.text.slice(start, trimmedEnd);
      annotations.push(
        document.addAnnotation<SentencePayload>(tierId, {
          ...range,
          payload: {
            text,
            ordinal,
            ...(options.language !== undefined ? { language: options.language } : {}),
          },
        }),
      );
      ordinal += 1;
    }
    cursor = Math.max(end, start + 1);
  }

  return annotations;
}

function nextNonWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function sentenceEnd(text: string, start: number): number {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const char = text[cursor] ?? "";
    if (char === "\n" && text[cursor + 1] === "\n") return cursor;
    if (!TERMINATORS.has(char)) continue;
    let end = cursor + 1;
    while (end < text.length && CLOSERS.has(text[end] ?? "")) end += 1;
    return end;
  }
  return text.length;
}

function trimRight(text: string, end: number): number {
  let cursor = end;
  while (cursor > 0 && /\s/u.test(text[cursor - 1] ?? "")) cursor -= 1;
  return cursor;
}
