import type { FiloAnnotationJson, FiloDocumentJson, FiloTierJson } from "./stores.svelte";

const textEncoder = new TextEncoder();

export function ipaForText(
  text: string | null | undefined,
  language: string | null | undefined,
  filoDoc?: FiloDocumentJson | null,
  baseByteOffset = 0,
): string | null {
  const sourceText = normalizeText(text);
  const targetLanguage = normalizeLanguage(language);
  if (!sourceText || !targetLanguage || !filoDoc) return null;

  const candidates = candidateIpaAnnotations(filoDoc, targetLanguage)
    .map((annotation) => ({
      annotation,
      score: ipaMatchScore(annotation, filoDoc, sourceText, baseByteOffset),
    }))
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0));

  for (const candidate of candidates) {
    const ipa = stringValue(candidate.annotation.payload.text).trim();
    if (ipa) return ipa;
  }
  return null;
}

export function formatIpa(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[/[].*[/\]]$/u.test(trimmed)) return trimmed;
  return `/${trimmed}/`;
}

function candidateIpaAnnotations(
  document: FiloDocumentJson,
  language: string,
): FiloAnnotationJson[] {
  return document.tiers.flatMap((tier) => {
    if (!isIpaTier(tier, language)) return [];
    return tier.annotations.filter((annotation) => {
      const payload = annotation.payload;
      return (
        stringValue(payload.system) === "ipa" &&
        normalizeLanguage(stringValue(payload.language)) === language
      );
    });
  });
}

function isIpaTier(tier: FiloTierJson, language: string): boolean {
  return tier.id === `ipa:${language}` || tier.kind === "phonetic";
}

function ipaMatchScore(
  annotation: FiloAnnotationJson,
  document: FiloDocumentJson,
  sourceText: string,
  baseByteOffset: number,
): number | null {
  const requestedStart = Math.max(0, baseByteOffset);
  const requestedEnd = requestedStart + textEncoder.encode(sourceText).length;
  if (annotation.start === requestedStart && annotation.end === requestedEnd) {
    return 0;
  }

  const spanText = normalizeText(sliceByByteRange(document.text, annotation.start, annotation.end));
  if (spanText === sourceText) return 1;

  const payloadSourceText = normalizeText(annotation.payload.sourceText);
  if (payloadSourceText === sourceText) return 2;

  if (normalizeText(document.text) === sourceText && annotation.start === 0) return 3;
  return null;
}

function sliceByByteRange(value: string, startByte: number, endByte: number): string {
  const start = stringIndexForByteOffset(value, startByte);
  const end = stringIndexForByteOffset(value, endByte);
  return value.slice(start, end);
}

function stringIndexForByteOffset(value: string, byteOffset: number): number {
  const target = Math.max(0, Math.min(byteOffset, textEncoder.encode(value).length));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const bytes = textEncoder.encode(value.slice(0, mid)).length;
    if (bytes < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function normalizeLanguage(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
