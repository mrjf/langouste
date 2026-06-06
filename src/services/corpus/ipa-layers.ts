import { annotatePhonetic } from "../../../filo/src/annotators/phonetic";
import type { FiloDocument } from "../../../filo/src/document";
import type { ByteRange, FiloAnnotation, PhoneticPayload } from "../../../filo/src/types";
import { transliterateText } from "../../../lit/src";

export interface IpaLayerInput extends ByteRange {
  language: string | null | undefined;
  text: string | null | undefined;
  sourceLanguage?: string | null;
  source?: string;
  tierId?: string;
}

export async function annotateIpaLayer(
  document: FiloDocument,
  input: IpaLayerInput,
): Promise<FiloAnnotation<PhoneticPayload> | null> {
  const language = (input.language ?? "und").trim().toLowerCase() || "und";
  const text = input.text?.trim() ?? "";
  if (language === "und" || !text || input.start >= input.end) return null;

  const tierId = input.tierId ?? `ipa:${language}`;
  const existing = document.tier<PhoneticPayload>(tierId)?.annotations.find((annotation) => {
    const payload = annotation.payload;
    return (
      annotation.start === input.start &&
      annotation.end === input.end &&
      payload.sourceText === text
    );
  });
  if (existing) return existing;

  try {
    const result = await transliterateText(text, {
      from: { system: "orthography", language },
      to: { system: "ipa", language },
    });
    if (!result.text.trim()) return null;
    return annotatePhonetic(document, {
      start: input.start,
      end: input.end,
      system: "ipa",
      language,
      text: result.text,
      sourceLanguage: input.sourceLanguage ?? language,
      sourceText: text,
      provider: result.provider,
      source: input.source ?? "langouste.lit",
      sourceInfo: {
        id: input.source ?? "langouste.lit",
        kind: "transliterator",
        label: "Langouste lit IPA transliterator",
        module: "lit",
        provider: result.provider,
      },
      tierId,
      payload: {
        ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      },
    });
  } catch (err) {
    if (!isMissingProviderError(err)) {
      console.warn(`[IPA] failed to annotate ${language} text:`, err);
    }
    return null;
  }
}

export async function annotateFullRangeIpaLayers(
  document: FiloDocument,
  inputs: Array<Omit<IpaLayerInput, "start" | "end">>,
): Promise<void> {
  if (document.byteLength === 0) return;
  const seen = new Set<string>();
  for (const input of inputs) {
    const language = (input.language ?? "und").trim().toLowerCase() || "und";
    const text = input.text?.trim() ?? "";
    const key = `${language}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await annotateIpaLayer(document, {
      ...input,
      start: 0,
      end: document.byteLength,
      language,
      text,
    });
  }
}

function isMissingProviderError(err: unknown): boolean {
  return err instanceof Error && /No deterministic lit provider/i.test(err.message);
}
