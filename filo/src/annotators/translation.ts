import type { FiloDocument } from "../document";
import type { ByteRange, FiloAnnotation, FiloSource, TranslationPayload } from "../types";

export interface TranslationAnnotationInput extends ByteRange {
  language: string;
  text: string;
  sourceLanguage?: string;
  source?: string;
  sourceInfo?: FiloSource;
  tierId?: string;
  payload?: Record<string, unknown>;
}

export function annotateTranslation(
  document: FiloDocument,
  input: TranslationAnnotationInput,
): FiloAnnotation<TranslationPayload> {
  const tierId = input.tierId ?? `translation:${input.language}`;
  document.ensureTier<TranslationPayload>({
    id: tierId,
    kind: "translation",
    description: `Translation spans for ${input.language}`,
    source: input.source ?? "filo.translation",
    ...(input.sourceInfo !== undefined ? { sourceInfo: input.sourceInfo } : {}),
  });
  const payload: TranslationPayload = {
    language: input.language,
    text: input.text,
    ...(input.sourceLanguage !== undefined ? { sourceLanguage: input.sourceLanguage } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...input.payload,
  };
  return document.addAnnotation<TranslationPayload>(tierId, {
    start: input.start,
    end: input.end,
    payload,
    source: input.source ?? "filo.translation",
    ...(input.sourceInfo !== undefined ? { sourceInfo: input.sourceInfo } : {}),
  });
}
