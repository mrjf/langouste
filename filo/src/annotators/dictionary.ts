import type { FiloDocument } from "../document";
import type { DictionaryLookupPayload, FiloAnnotation, WordPayload } from "../types";

export interface DictionaryLookupInput {
  surface: string;
  normalized: string;
  language: string;
  start: number;
  end: number;
  wordAnnotationId: string;
}

export interface DictionaryLookupResult {
  definitions: string[];
  lemma?: string;
  partOfSpeech?: string;
  source?: string;
  sourceUrl?: string;
  [key: string]: unknown;
}

export type DictionaryLookupFn = (
  input: DictionaryLookupInput,
) => Promise<DictionaryLookupResult | null>;

export interface DictionaryAnnotatorOptions {
  language: string;
  lookup: DictionaryLookupFn;
  wordTierId?: string;
  outputTierId?: string;
  includeMisses?: boolean;
  source?: string;
}

export async function annotateDictionaryLookups(
  document: FiloDocument,
  options: DictionaryAnnotatorOptions,
): Promise<Array<FiloAnnotation<DictionaryLookupPayload>>> {
  const wordTierId = options.wordTierId ?? "word";
  const outputTierId = options.outputTierId ?? "dictionary";
  document.ensureTier<DictionaryLookupPayload>({
    id: outputTierId,
    kind: "dictionary.lookup",
    description: "Dictionary lookups aligned to word byte ranges",
    source: options.source ?? "filo.dictionary",
  });

  const words = document.requireTier<WordPayload>(wordTierId).annotations;
  const annotations: Array<FiloAnnotation<DictionaryLookupPayload>> = [];

  for (const word of words) {
    const lookup = await options.lookup({
      surface: word.payload.surface,
      normalized: word.payload.normalized,
      language: options.language,
      start: word.start,
      end: word.end,
      wordAnnotationId: word.id,
    });
    if (!lookup && !options.includeMisses) continue;

    annotations.push(
      document.addAnnotation<DictionaryLookupPayload>(outputTierId, {
        start: word.start,
        end: word.end,
        payload: {
          ...(lookup ?? {}),
          surface: word.payload.surface,
          language: options.language,
          wordAnnotationId: word.id,
          definitions: lookup?.definitions ?? [],
          notFound: lookup === null,
        },
        source: options.source ?? "filo.dictionary",
      }),
    );
  }

  return annotations;
}
