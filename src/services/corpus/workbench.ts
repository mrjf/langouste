import { randomUUID } from "node:crypto";
import {
  FiloDocument,
  annotatePhraseBoundaries,
  annotateSentences,
  annotateTranslation,
  annotateWords,
  type ByteRange,
  type DictionaryLookupPayload,
  type FiloAnnotation,
  type FiloDocumentJson,
  type PhrasePayload,
  type SentencePayload,
  type TranslationPayload,
  type WordPayload,
} from "filo";
import { translateTexts } from "../ai/translator.ts";
import { annotateIpaLayer } from "./ipa-layers.ts";
import { normalizeVocabularyTerm } from "../spaced-repetition/vocabulary-normalizer.ts";
import { annotateGrammarProperties } from "./grammar-properties.ts";

export interface WorkbenchAnalysisInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  title?: string;
  includeProperTranslations?: boolean;
  document?: FiloDocumentJson;
}

export interface WorkbenchAnalysisResult {
  document: FiloDocumentJson;
  summary: {
    words: number;
    sentences: number;
    phrases: number;
    targetLanguage: string;
  };
}

const MAX_TRANSLATED_SPANS = 80;
const MAX_LITERAL_FALLBACK_WORDS = 240;
const WORKBENCH_ANALYSIS_VERSION = 4;

interface LiteralGloss {
  surface: string;
  lemma: string | null;
  gloss: string;
  wordAnnotationId: string | null;
  dictionaryAnnotationId: string | null;
  source: "dictionary" | "translation" | "not-found";
  notFound: boolean;
}

export async function analyzeWorkbenchDocument(
  input: WorkbenchAnalysisInput,
): Promise<WorkbenchAnalysisResult> {
  const sourceLanguage = input.sourceLanguage || "und";
  const targetLanguage = input.targetLanguage || "en";
  const includeProperTranslations = input.includeProperTranslations ?? true;
  const existingDocument = reusableInputDocument(input.document, input.text);

  if (
    existingDocument &&
    hasWorkbenchAnalysis(existingDocument, {
      sourceLanguage,
      targetLanguage,
      includeProperTranslations,
    })
  ) {
    return resultFromDocument(existingDocument, targetLanguage);
  }

  const baseDocument =
    existingDocument ??
    newWorkbenchDocument(input.text, {
      sourceLanguage,
      targetLanguage,
      title: input.title,
    });

  const document = FiloDocument.fromJSON(prepareDocumentForWorkbench(baseDocument, targetLanguage));

  ensureWordTier(document, sourceLanguage);
  ensureSentenceTier(document, sourceLanguage);
  ensurePhraseTier(document, sourceLanguage);
  await annotateWorkbenchDictionary(document, sourceLanguage);
  await annotateWordLiteralTranslations(document, {
    sourceLanguage,
    targetLanguage,
    allowTranslationFallback: includeProperTranslations,
  });
  await annotateSpanTranslationLevels(document, {
    sourceLanguage,
    targetLanguage,
    tierId: "sentence",
    level: "sentence",
    includeProperTranslations,
  });
  await annotateSpanTranslationLevels(document, {
    sourceLanguage,
    targetLanguage,
    tierId: "phrase",
    level: "phrase",
    includeProperTranslations,
  });
  annotateGrammarProperties(document, sourceLanguage);
  await annotateWorkbenchIpa(document, sourceLanguage);

  const analyzed = markWorkbenchAnalysis(document.toJSON(), {
    sourceLanguage,
    targetLanguage,
    includeProperTranslations,
  });
  return resultFromDocument(analyzed, targetLanguage);
}

async function annotateWorkbenchIpa(document: FiloDocument, sourceLanguage: string): Promise<void> {
  await annotateIpaLayer(document, {
    start: 0,
    end: document.byteLength,
    language: sourceLanguage,
    text: document.text,
    sourceLanguage,
    source: "langouste.workbench.lit",
  });
}

function reusableInputDocument(
  document: FiloDocumentJson | undefined,
  text: string,
): FiloDocumentJson | null {
  if (!document || document.text !== text) return null;
  try {
    FiloDocument.fromJSON(document);
    return document;
  } catch (err) {
    console.warn("[Workbench] ignoring invalid input Filo document:", err);
    return null;
  }
}

function newWorkbenchDocument(
  text: string,
  options: { sourceLanguage: string; targetLanguage: string; title?: string },
): FiloDocumentJson {
  return FiloDocument.fromText(text, {
    id: `workbench:${randomUUID()}`,
    metadata: {
      corpus: "workbench",
      title: options.title?.trim() || null,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      createdAt: new Date().toISOString(),
    },
  }).toJSON();
}

function prepareDocumentForWorkbench(
  document: FiloDocumentJson,
  targetLanguage: string,
): FiloDocumentJson {
  const staleTierIds = new Set([
    "dictionary",
    "grammar",
    `word.translation:${targetLanguage}:literal`,
    `sentence.translation:${targetLanguage}:literal`,
    `sentence.translation:${targetLanguage}:proper`,
    `phrase.translation:${targetLanguage}:literal`,
    `phrase.translation:${targetLanguage}:proper`,
  ]);
  return {
    ...document,
    metadata: {
      ...document.metadata,
      corpus: document.metadata?.corpus ?? "workbench",
    },
    tiers: document.tiers.filter((tier) => !staleTierIds.has(tier.id)),
  };
}

function analysisKey(options: {
  sourceLanguage: string;
  targetLanguage: string;
  includeProperTranslations: boolean;
}): string {
  return [
    options.sourceLanguage || "und",
    options.targetLanguage || "und",
    options.includeProperTranslations ? "proper" : "literal",
  ].join(":");
}

function hasWorkbenchAnalysis(
  document: FiloDocumentJson,
  options: {
    sourceLanguage: string;
    targetLanguage: string;
    includeProperTranslations: boolean;
  },
): boolean {
  const metadata = document.metadata as Record<string, unknown>;
  const analyses = metadata.workbenchAnalyses as Record<string, unknown> | undefined;
  const analysis = analyses?.[analysisKey(options)] as Record<string, unknown> | undefined;
  if (analysis?.version !== WORKBENCH_ANALYSIS_VERSION) return false;
  return (
    hasRequiredWorkbenchDictionaryCoverage(document) &&
    hasRequiredWorkbenchGrammarCoverage(document) &&
    hasRequiredWorkbenchTranslationCoverage(document, options)
  );
}

function hasRequiredWorkbenchGrammarCoverage(document: FiloDocumentJson): boolean {
  return !!tier(document, "grammar");
}

function hasRequiredWorkbenchDictionaryCoverage(document: FiloDocumentJson): boolean {
  return !hasDictionaryLookupErrors(document);
}

function hasDictionaryLookupErrors(document: FiloDocumentJson): boolean {
  return (
    tier(document, "dictionary")?.annotations.some(
      (annotation) =>
        stringValue(annotation.payload?.lookupStatus) === "error" ||
        !!stringValue(annotation.payload?.lookupError),
    ) ?? false
  );
}

function hasRequiredWorkbenchTranslationCoverage(
  document: FiloDocumentJson,
  options: {
    sourceLanguage: string;
    targetLanguage: string;
    includeProperTranslations: boolean;
  },
): boolean {
  if (!options.includeProperTranslations) return true;
  return (
    hasTranslationCoverage(
      document,
      "sentence",
      `sentence.translation:${options.targetLanguage}:proper`,
    ) &&
    hasTranslationCoverage(
      document,
      "phrase",
      `phrase.translation:${options.targetLanguage}:proper`,
    )
  );
}

function hasTranslationCoverage(
  document: FiloDocumentJson,
  sourceTierId: string,
  translationTierId: string,
): boolean {
  const sourceAnnotations = tier(document, sourceTierId)?.annotations.slice(
    0,
    MAX_TRANSLATED_SPANS,
  );
  if (!sourceAnnotations || sourceAnnotations.length === 0) return true;
  const translations = tier(document, translationTierId)?.annotations ?? [];
  if (translations.length === 0) return false;
  const translatedRanges = new Set(
    translations
      .filter((annotation) => stringValue(annotation.payload?.text))
      .map((annotation) => rangeKey(annotation)),
  );
  return sourceAnnotations.every((annotation) => translatedRanges.has(rangeKey(annotation)));
}

function rangeKey(range: ByteRange): string {
  return `${range.start}:${range.end}`;
}

function markWorkbenchAnalysis(
  document: FiloDocumentJson,
  options: {
    sourceLanguage: string;
    targetLanguage: string;
    includeProperTranslations: boolean;
  },
): FiloDocumentJson {
  const metadata = document.metadata as Record<string, unknown>;
  const analyses =
    metadata.workbenchAnalyses && typeof metadata.workbenchAnalyses === "object"
      ? { ...(metadata.workbenchAnalyses as Record<string, unknown>) }
      : {};
  analyses[analysisKey(options)] = {
    version: WORKBENCH_ANALYSIS_VERSION,
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    includeProperTranslations: options.includeProperTranslations,
    analyzedAt: new Date().toISOString(),
  };
  return {
    ...document,
    metadata: {
      ...metadata,
      workbenchAnalyses: analyses,
    },
  };
}

function resultFromDocument(
  document: FiloDocumentJson,
  targetLanguage: string,
): WorkbenchAnalysisResult {
  return {
    document,
    summary: {
      words: tier(document, "word")?.annotations.length ?? 0,
      sentences: tier(document, "sentence")?.annotations.length ?? 0,
      phrases: tier(document, "phrase")?.annotations.length ?? 0,
      targetLanguage,
    },
  };
}

function tier(document: FiloDocumentJson, tierId: string) {
  return document.tiers.find((candidate) => candidate.id === tierId) ?? null;
}

function ensureWordTier(document: FiloDocument, sourceLanguage: string): void {
  if ((document.tier("word")?.annotations.length ?? 0) > 0) return;
  annotateWords(document, { language: sourceLanguage, source: "langouste.workbench" });
}

function ensureSentenceTier(document: FiloDocument, sourceLanguage: string): void {
  if ((document.tier("sentence")?.annotations.length ?? 0) > 0) return;
  annotateSentences(document, { language: sourceLanguage, source: "langouste.workbench" });
}

function ensurePhraseTier(document: FiloDocument, sourceLanguage: string): void {
  if ((document.tier("phrase")?.annotations.length ?? 0) > 0) return;
  if (sourceLanguage === "en") {
    annotatePhraseBoundaries(document, {
      language: sourceLanguage,
      source: "langouste.workbench.phrases",
    });
  }
  annotateFallbackPhrases(document, sourceLanguage);
}

async function annotateWorkbenchDictionary(
  document: FiloDocument,
  language: string,
): Promise<void> {
  if (language === "und") return;
  const dictionaryTier = document.ensureTier<DictionaryLookupPayload>({
    id: "dictionary",
    kind: "dictionary.lookup",
    description: "Dictionary lookups aligned to word byte ranges",
    source: "langouste.workbench.dictionary",
  });
  const existingWordIds = new Set(
    dictionaryTier.annotations
      .map((annotation) => annotation.payload.wordAnnotationId)
      .filter((value): value is string => typeof value === "string"),
  );

  for (const word of document.tier<WordPayload>("word")?.annotations ?? []) {
    if (existingWordIds.has(word.id)) continue;
    const surface = word.payload.surface;
    const normalized = await normalizeVocabularyTerm(surface, language);
    const lookup =
      normalized.lookup_status !== "error" &&
      (normalized.definition ||
        normalized.source_term ||
        normalized.form_description ||
        isMeaningfulLemmaChange(normalized.term, surface, language))
        ? {
            lemma: normalized.term || surface,
            definitions: normalized.definition ? [normalized.definition] : [],
            source:
              normalized.lookup_source === "wiktionary"
                ? "wiktionary"
                : "langouste-local-dictionary",
            sourceTerm: normalized.source_term,
            formDescription: normalized.form_description,
          }
        : null;
    document.addAnnotation<DictionaryLookupPayload>("dictionary", {
      start: word.start,
      end: word.end,
      payload: {
        ...(lookup ?? {}),
        surface,
        language,
        wordAnnotationId: word.id,
        definitions: lookup?.definitions ?? [],
        notFound: normalized.lookup_status === "not-found",
        lookupStatus: normalized.lookup_status,
        lookupError: normalized.lookup_error,
      },
      source: "langouste.workbench.dictionary",
    });
  }
}

async function annotateWordLiteralTranslations(
  document: FiloDocument,
  options: {
    sourceLanguage: string;
    targetLanguage: string;
    allowTranslationFallback: boolean;
  },
): Promise<void> {
  const wordTier = document.tier<WordPayload>("word");
  if (!wordTier) return;

  const dictionaryByWordId = new Map<string, FiloAnnotation<DictionaryLookupPayload>>();
  for (const annotation of document.tier<DictionaryLookupPayload>("dictionary")?.annotations ??
    []) {
    const wordAnnotationId = annotation.payload.wordAnnotationId;
    if (typeof wordAnnotationId === "string") {
      dictionaryByWordId.set(wordAnnotationId, annotation);
    }
  }

  const translationBySurface =
    options.allowTranslationFallback &&
    options.targetLanguage &&
    options.sourceLanguage !== options.targetLanguage
      ? await fallbackWordTranslations(wordTier.annotations, document, options)
      : new Map<string, string>();

  const glosses = new Map<string, LiteralGloss>();
  for (const word of wordTier.annotations) {
    const surface = document.textOf(word);
    const translatedGloss = translationBySurface.get(surface);
    if (isUsefulGloss(translatedGloss, surface, null, options.sourceLanguage)) {
      glosses.set(word.id, {
        surface,
        lemma: null,
        gloss: cleanLiteralGloss(translatedGloss),
        wordAnnotationId: word.id,
        dictionaryAnnotationId: null,
        source: "translation",
        notFound: false,
      });
      continue;
    }

    const dictionaryEntry = dictionaryByWordId.get(word.id);
    const dictionaryLiteral = dictionaryEntry ? dictionaryGloss(dictionaryEntry) : null;
    if (dictionaryLiteral?.gloss) {
      glosses.set(word.id, dictionaryLiteral);
    }
  }

  for (const word of wordTier.annotations) {
    const gloss = glosses.get(word.id);
    if (!gloss?.gloss) continue;
    annotateTranslation(document, {
      ...word,
      tierId: `word.translation:${options.targetLanguage}:literal`,
      language: options.targetLanguage,
      sourceLanguage: options.sourceLanguage,
      text: gloss.gloss,
      source:
        gloss.source === "translation"
          ? "langouste.workbench.word-translation"
          : gloss.source === "dictionary"
            ? "langouste.workbench.dictionary-gloss"
            : "langouste.workbench.not-found-gloss",
      payload: {
        level: "word",
        mode: "literal",
        glossLanguage: options.targetLanguage,
        surface: gloss.surface,
        lemma: gloss.lemma,
        sourceWordAnnotationId: gloss.wordAnnotationId,
        dictionaryAnnotationId: gloss.dictionaryAnnotationId,
        glossSource: gloss.source,
        notFound: gloss.notFound,
      },
    });
  }
}

async function fallbackWordTranslations(
  words: Array<FiloAnnotation<WordPayload>>,
  document: FiloDocument,
  options: { sourceLanguage: string; targetLanguage: string },
): Promise<Map<string, string>> {
  const uniqueSurfaces = [...new Set(words.map((word) => document.textOf(word)))]
    .filter((surface) => surface.trim())
    .slice(0, MAX_LITERAL_FALLBACK_WORDS);
  if (uniqueSurfaces.length === 0) return new Map();

  const translations = await safeTranslate(
    uniqueSurfaces,
    options.targetLanguage,
    `These are ${options.sourceLanguage} word forms from one source text for an interlinear literal gloss. Return concise dictionary-style equivalents in ${options.targetLanguage}; omit the source words; preserve important case, possession, definiteness, and person information when it changes meaning; do not add explanations.`,
  );

  const translationBySurface = new Map<string, string>();
  for (let index = 0; index < uniqueSurfaces.length; index += 1) {
    translationBySurface.set(uniqueSurfaces[index], translations[index] ?? "");
  }
  return translationBySurface;
}

function annotateFallbackPhrases(document: FiloDocument, language: string): void {
  const phraseTier = document.ensureTier<PhrasePayload>({
    id: "phrase",
    kind: "phrase",
    description: "Phrase and clause boundaries",
    source: "langouste.workbench.fallback-phrases",
  });
  if (phraseTier.annotations.length > 0) return;

  const sentenceTier = document.tier<SentencePayload>("sentence");
  if (!sentenceTier) return;

  for (const sentence of sentenceTier.annotations) {
    const sentenceText = document.textOf(sentence);
    const sentenceStart = document.stringIndexForByteOffset(sentence.start);
    let added = 0;
    for (const match of sentenceText.matchAll(/[^,;:—–]+/gu)) {
      const raw = match[0];
      const rawStart = match.index ?? 0;
      const trimmedStart = raw.search(/\S/u);
      if (trimmedStart < 0) continue;
      const trimmedEnd = raw.length - raw.split("").reverse().join("").search(/\S/u);
      const startStringIndex = sentenceStart + rawStart + trimmedStart;
      const endStringIndex = sentenceStart + rawStart + trimmedEnd;
      const phraseText = document.text.slice(startStringIndex, endStringIndex);
      if (wordCount(phraseText) < 2) continue;
      document.addAnnotation<PhrasePayload>("phrase", {
        ...document.byteRangeForStringIndices(startStringIndex, endStringIndex),
        payload: {
          label: "phrase",
          phraseType: "clause",
          language,
          text: phraseText,
        },
      });
      added += 1;
    }

    if (added === 0 && wordCount(sentenceText) > 1) {
      document.addAnnotation<PhrasePayload>("phrase", {
        start: sentence.start,
        end: sentence.end,
        payload: {
          label: "sentence phrase",
          phraseType: "sentence",
          language,
          text: sentenceText,
        },
      });
    }
  }
}

async function annotateSpanTranslationLevels(
  document: FiloDocument,
  options: {
    sourceLanguage: string;
    targetLanguage: string;
    tierId: string;
    level: "sentence" | "phrase";
    includeProperTranslations: boolean;
  },
): Promise<void> {
  const spanTier = document.tier(options.tierId);
  if (!spanTier) return;
  const spans = spanTier.annotations.slice(0, MAX_TRANSLATED_SPANS);
  const texts = spans.map((span) => document.textOf(span));

  const properTranslations =
    options.includeProperTranslations && options.targetLanguage === options.sourceLanguage
      ? texts
      : options.includeProperTranslations && texts.length > 0
        ? await safeTranslate(texts, options.targetLanguage)
        : [];

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const proper = properTranslations[index];
    if (proper) {
      annotateTranslation(document, {
        ...span,
        tierId: `${options.level}.translation:${options.targetLanguage}:proper`,
        language: options.targetLanguage,
        sourceLanguage: options.sourceLanguage,
        text: proper,
        source: "langouste.workbench.translation",
        payload: {
          level: options.level,
          mode: "proper",
        },
      });
    }

    const literal = literalGlossForRange(document, span, options.targetLanguage);
    if (literal.text) {
      annotateTranslation(document, {
        ...span,
        tierId: `${options.level}.translation:${options.targetLanguage}:literal`,
        language: options.targetLanguage,
        sourceLanguage: options.sourceLanguage,
        text: literal.text,
        source: "langouste.workbench.dictionary-gloss",
        payload: {
          level: options.level,
          mode: "literal",
          glossLanguage: options.targetLanguage,
          glosses: literal.glosses,
        },
      });
    }
  }
}

async function safeTranslate(
  texts: string[],
  targetLanguage: string,
  context?: string,
): Promise<string[]> {
  if (!targetLanguage) return [];
  try {
    return await translateTexts(texts, targetLanguage, context);
  } catch (err) {
    console.error("[Workbench] span translation failed:", err);
    return [];
  }
}

function literalGlossForRange(
  document: FiloDocument,
  range: ByteRange,
  targetLanguage: string,
): {
  text: string;
  glosses: LiteralGloss[];
} {
  const translationTier = document.tier<TranslationPayload>(
    `word.translation:${targetLanguage}:literal`,
  );
  if (!translationTier) return { text: "", glosses: [] };
  const glosses = translationTier.annotations
    .filter((entry) => range.start <= entry.start && entry.end <= range.end)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((entry) => literalGlossFromTranslation(document, entry))
    .filter((gloss) => gloss.gloss);
  return {
    text: glosses.map((gloss) => gloss.gloss).join(" · "),
    glosses,
  };
}

function literalGlossFromTranslation(
  document: FiloDocument,
  annotation: FiloAnnotation<TranslationPayload>,
): LiteralGloss {
  const payload = annotation.payload;
  const surface = stringValue(payload.surface) || document.textOf(annotation);
  return {
    surface,
    lemma: stringValue(payload.lemma) || null,
    gloss: cleanLiteralGloss(payload.text),
    wordAnnotationId: stringValue(payload.sourceWordAnnotationId) || null,
    dictionaryAnnotationId: stringValue(payload.dictionaryAnnotationId) || null,
    source:
      payload.glossSource === "translation"
        ? "translation"
        : payload.glossSource === "not-found"
          ? "not-found"
          : "dictionary",
    notFound: payload.notFound === true,
  };
}

function dictionaryGloss(annotation: FiloAnnotation<DictionaryLookupPayload>): LiteralGloss {
  const payload = annotation.payload;
  const surface = stringValue(payload.surface);
  const lemma = stringValue(payload.lemma) || null;
  const definition = Array.isArray(payload.definitions)
    ? bestLiteralDefinition(payload.definitions)
    : "";
  const notFound = payload.notFound === true;
  if (notFound && surface) {
    return {
      surface,
      lemma,
      gloss: surface,
      wordAnnotationId: stringValue(payload.wordAnnotationId) || null,
      dictionaryAnnotationId: annotation.id,
      source: "not-found",
      notFound: true,
    };
  }
  return {
    surface,
    lemma,
    gloss: isUsefulGloss(definition, surface, lemma, payload.language) ? definition : "",
    wordAnnotationId: stringValue(payload.wordAnnotationId) || null,
    dictionaryAnnotationId: annotation.id,
    source: "dictionary",
    notFound: false,
  };
}

function isUsefulGloss(
  value: string | null | undefined,
  surface: string,
  lemma: string | null,
  language: string,
): boolean {
  const gloss = cleanLiteralGloss(value);
  if (!gloss) return false;
  const locale = language || undefined;
  const normalizedGloss = normalizeEquivalent(gloss, locale);
  const equivalentSources = [surface, lemma ?? ""]
    .map((candidate) => normalizeEquivalent(candidate, locale))
    .filter(Boolean);
  return !equivalentSources.includes(normalizedGloss);
}

function isMeaningfulLemmaChange(lemma: string, surface: string, language: string): boolean {
  if (!lemma) return false;
  return (
    normalizeEquivalent(lemma, language || undefined) !==
    normalizeEquivalent(surface, language || undefined)
  );
}

function cleanLiteralGloss(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/^["“”]+|["“”]+$/gu, "")
    .trim();
}

function bestLiteralDefinition(definitions: unknown[]): string {
  const cleaned = definitions
    .filter((definition): definition is string => typeof definition === "string")
    .map((definition) => cleanLiteralGloss(definition))
    .filter(Boolean);
  return (
    cleaned.find(
      (definition) => !/^\((?:archaic|dated|historical|obsolete|rare)\)/iu.test(definition),
    ) ??
    cleaned[0] ??
    ""
  );
}

function normalizeEquivalent(value: string, locale: string | undefined): string {
  return cleanLiteralGloss(value)
    .replace(/[.,;:!?()[\]{}"“”'’`]+/gu, "")
    .toLocaleLowerCase(locale);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wordCount(text: string): number {
  return [...text.matchAll(/[\p{Letter}\p{Mark}\p{Number}]+/gu)].length;
}
