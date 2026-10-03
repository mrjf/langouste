import type { FiloAnnotation, FiloDocumentJson, FiloTierJson } from "filo";
import type {
  ExplanationPayload,
  GrammarPayload,
  ReadingDocumentMetadata,
  TranslationPayload,
  VocabularyPayload,
  WordAlignmentPayload,
} from "../../types/news";

export interface ReadingRow {
  ordinal: number;
  start: number;
  end: number;
  baseText: string;
  sourceWords: string[];
  languages: Record<string, ReadingCell>;
}

export interface ReadingCell {
  text: string;
  tokens: WordAlignmentPayload["tokens"];
  explanation: string;
  grammar: GrammarPayload[];
  vocabulary: VocabularyPayload[];
}

export function rowsFromDocument(
  document: FiloDocumentJson<ReadingDocumentMetadata>,
): ReadingRow[] {
  const sentences = tier(document, "sentence")?.annotations ?? [];
  return sentences.map((sentence) => {
    const payload = sentence.payload as Record<string, unknown>;
    const ordinal = typeof payload.ordinal === "number" ? payload.ordinal : 0;
    return {
      ordinal,
      start: sentence.start,
      end: sentence.end,
      baseText: typeof payload.text === "string" ? payload.text : "",
      sourceWords: sourceWordsAt(document, sentence),
      languages: Object.fromEntries(
        document.metadata.languages.map((language) => [
          language,
          cellAt(document, language, sentence),
        ]),
      ),
    };
  });
}

function sourceWordsAt(
  document: FiloDocumentJson<ReadingDocumentMetadata>,
  sentence: FiloAnnotation<unknown>,
): string[] {
  const words = (tier(document, "word")?.annotations ?? [])
    .filter((word) => word.start >= sentence.start && word.end <= sentence.end)
    .map((word) => {
      const payload = word.payload as Record<string, unknown>;
      return typeof payload.surface === "string"
        ? payload.surface
        : document.text.slice(word.start, word.end);
    })
    .filter(Boolean);
  if (words.length) return words;

  const payload = sentence.payload as Record<string, unknown>;
  const text =
    typeof payload.text === "string"
      ? payload.text
      : document.text.slice(sentence.start, sentence.end);
  return text.match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

function cellAt(
  document: FiloDocumentJson<ReadingDocumentMetadata>,
  language: string,
  sentence: FiloAnnotation<unknown>,
): ReadingCell {
  const translation = exactAt<TranslationPayload>(
    tier(document, `sentence.translation:${language}`),
    sentence,
  )[0]?.payload;
  const alignment = exactAt<WordAlignmentPayload>(
    tier(document, `sentence.word-alignment:${language}`),
    sentence,
  )[0]?.payload;
  const explanation = exactAt<ExplanationPayload>(
    tier(document, `sentence.explanation:${language}`),
    sentence,
  )[0]?.payload;
  return {
    text: translation?.text ?? "",
    tokens: alignment?.tokens ?? [],
    explanation: explanation?.text ?? "",
    grammar: exactAt<GrammarPayload>(tier(document, `sentence.grammar:${language}`), sentence).map(
      (annotation) => annotation.payload,
    ),
    vocabulary: exactAt<VocabularyPayload>(
      tier(document, `sentence.vocabulary:${language}`),
      sentence,
    ).map((annotation) => annotation.payload),
  };
}

function tier(document: FiloDocumentJson, id: string): FiloTierJson | undefined {
  return document.tiers.find((candidate) => candidate.id === id);
}

function exactAt<T extends Record<string, unknown>>(
  candidate: FiloTierJson | undefined,
  range: { start: number; end: number },
): Array<FiloAnnotation<T>> {
  return (candidate?.annotations ?? []).filter(
    (annotation) => annotation.start === range.start && annotation.end === range.end,
  ) as Array<FiloAnnotation<T>>;
}

export function workbenchUrl(input: {
  text: string;
  sourceLanguage: string;
  title: string;
}): string {
  const params = new URLSearchParams({
    text: input.text,
    source_language: input.sourceLanguage,
    target_language: "en",
    title: input.title,
    auto: "1",
  });
  return `#/workbench?${params.toString()}`;
}

export function dictionaryUrl(term: string, language: string): string {
  return `#/dictionary/${encodeURIComponent(language)}/${encodeURIComponent(term)}`;
}
