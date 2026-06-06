import type { FiloDocument } from "../document";
import type { ByteRange, FiloAnnotation, FiloSource, PhoneticPayload } from "../types";

export interface PhoneticAnnotationInput extends ByteRange {
  system: string;
  language: string;
  text: string;
  sourceLanguage?: string;
  sourceText?: string;
  provider?: string;
  source?: string;
  sourceInfo?: FiloSource;
  tierId?: string;
  payload?: Record<string, unknown>;
}

export function annotatePhonetic(
  document: FiloDocument,
  input: PhoneticAnnotationInput,
): FiloAnnotation<PhoneticPayload> {
  const tierId = input.tierId ?? `${input.system}:${input.language}`;
  document.ensureTier<PhoneticPayload>({
    id: tierId,
    kind: "phonetic",
    description: `${input.system.toUpperCase()} phonetic layer for ${input.language}`,
    source: input.source ?? "filo.phonetic",
    ...(input.sourceInfo !== undefined ? { sourceInfo: input.sourceInfo } : {}),
  });
  const payload: PhoneticPayload = {
    system: input.system,
    language: input.language,
    text: input.text,
    ...(input.sourceLanguage !== undefined ? { sourceLanguage: input.sourceLanguage } : {}),
    ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...input.payload,
  };
  return document.addAnnotation<PhoneticPayload>(tierId, {
    start: input.start,
    end: input.end,
    payload,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.sourceInfo !== undefined ? { sourceInfo: input.sourceInfo } : {}),
  });
}
