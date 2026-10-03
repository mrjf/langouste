import { FiloDocument, type FiloAnnotation, type FiloDocumentJson } from "filo";
import { config } from "../../lib/config.ts";
import { languageName } from "../../lib/languages.ts";
import { getAnthropicClient } from "../ai/client.ts";
import { requireArray, toolInputObject } from "../ai/tool-output.ts";
import type {
  SourceSentencePayload,
  SourceTranscriptMetadata,
  SourceWordPayload,
} from "./types.ts";

export interface ExtractedSentenceReference {
  sourceTierId: "sentence";
  sourceAnnotationId: string;
  text: string;
  language: string;
  fullSentence: boolean;
  correctedText?: string;
  translation?: string;
  reason?: string;
  confidence?: number;
  lessonEligible?: boolean;
  teachingScore?: number;
  qualityFlags?: string[];
}

export interface SentenceExtractionInput {
  source: FiloDocumentJson<SourceTranscriptMetadata>;
  sourceLanguage: string;
  bridgeLanguage: string;
  /** Bound review cost for long recordings; selection still deduplicates the reviewed window. */
  maxCandidates?: number;
}

export interface SourceSentenceExtractor {
  extractSentences(input: SentenceExtractionInput): Promise<ExtractedSentenceReference[]>;
}

const SOURCE_SENTENCE_EXTRACTION_TOOL = {
  name: "extract_training_sentences" as const,
  description:
    "Select complete source-language sentences from a timed Filo transcript for audio language training.",
  input_schema: {
    type: "object" as const,
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sourceAnnotationId: {
              type: "string",
              description: "The exact Filo sentence annotation id from the candidate list.",
            },
            language: {
              type: "string",
              description: "ISO 639-1 language code for this candidate's spoken language.",
            },
            fullSentence: {
              type: "boolean",
              description: "True only if the item is a complete sentence or complete utterance.",
            },
            correctedText: {
              type: "string",
              description:
                "The same spoken words with only spacing, casing, diacritics, and punctuation repaired.",
            },
            translation: {
              type: "string",
              description: "Concise translation into the bridge language.",
            },
            reason: {
              type: "string",
              description: "Short reason for inclusion/exclusion and language choice.",
            },
            confidence: {
              type: "number",
              description: "0-1 confidence in the language/full-sentence decision.",
            },
            lessonEligible: {
              type: "boolean",
              description:
                "True only for a natural, self-contained, useful utterance suitable for beginner practice.",
            },
            teachingScore: {
              type: "number",
              description: "0-1 beginner teaching value, naturalness, and self-containedness.",
            },
            qualityFlags: {
              type: "array",
              items: { type: "string" },
              description:
                "Short machine-readable concerns such as fragment, narration, archaic, ambiguous, or asr_error.",
            },
          },
          required: [
            "sourceAnnotationId",
            "language",
            "fullSentence",
            "correctedText",
            "translation",
            "reason",
            "confidence",
            "lessonEligible",
            "teachingScore",
            "qualityFlags",
          ],
        },
      },
    },
    required: ["sentences"],
  },
};

const EXTRACTION_BATCH_SIZE = 12;
const EXTRACTION_CONCURRENCY = 4;
const EXTRACTION_ATTEMPTS = 2;

interface SentenceCandidate {
  sourceAnnotationId: string;
  text: string;
  language: string;
  startMs: number;
  endMs: number;
  wordCount: number;
  words: string[];
  previousText?: string;
  nextText?: string;
  occurrenceCount?: number;
}

export class ClaudeSourceSentenceExtractor implements SourceSentenceExtractor {
  async extractSentences(input: SentenceExtractionInput): Promise<ExtractedSentenceReference[]> {
    if (config.stubAi) return fallbackExtractSentences(input);

    const sourceDocument = FiloDocument.fromJSON(input.source);
    const sourceCandidates = sentenceCandidates(sourceDocument).slice(
      0,
      input.maxCandidates ?? Number.POSITIVE_INFINITY,
    );
    if (sourceCandidates.length === 0) return [];
    const { representatives, representativeIdByCandidateId } = coalesceCandidates(sourceCandidates);

    const sourceLanguageName = languageName(input.sourceLanguage);
    const bridgeLanguageName = languageName(input.bridgeLanguage);
    const batches = chunk(representatives, EXTRACTION_BATCH_SIZE);
    const extracted = await mapWithConcurrency(
      batches,
      EXTRACTION_CONCURRENCY,
      async (batch, batchIndex) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < EXTRACTION_ATTEMPTS; attempt += 1) {
          try {
            const result = await this.extractBatch(batch, {
              sourceLanguage: input.sourceLanguage,
              sourceLanguageName,
              bridgeLanguage: input.bridgeLanguage,
              bridgeLanguageName,
            });
            console.log(
              `[Audio drill] Reviewed transcript batch ${batchIndex + 1}/${batches.length}`,
            );
            return result;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError ?? new Error("Source sentence extraction batch failed");
      },
    );
    const extractedByRepresentativeId = new Map(
      extracted.flat().map((sentence) => [sentence.sourceAnnotationId, sentence]),
    );
    const expanded = sourceCandidates.flatMap((candidate) => {
      const representativeId = representativeIdByCandidateId.get(candidate.sourceAnnotationId);
      const result = representativeId
        ? extractedByRepresentativeId.get(representativeId)
        : undefined;
      return result
        ? [{ ...result, sourceAnnotationId: candidate.sourceAnnotationId, text: candidate.text }]
        : [];
    });
    return normalizeExtractorOutput(input, expanded);
  }

  private async extractBatch(
    candidates: SentenceCandidate[],
    languages: {
      sourceLanguage: string;
      sourceLanguageName: string;
      bridgeLanguage: string;
      bridgeLanguageName: string;
    },
  ): Promise<ExtractedSentenceReference[]> {
    const prompt = `You are preparing a high-quality guided audio-drill lesson from a noisy timed transcript.

Source language: ${languages.sourceLanguageName} (${languages.sourceLanguage})
Bridge language: ${languages.bridgeLanguageName} (${languages.bridgeLanguage})

Return exactly one result for every candidate and keep sourceAnnotationId byte-identical.

- Identify the language actually spoken. Do not label bridge-language narration as source language.
- Set fullSentence for a complete sentence or conventional standalone utterance, not a title, label,
  vocabulary list, isolated buildup fragment, or accidental ASR grouping.
- correctedText must contain exactly the same spoken words. Repair only orthographic spacing, casing,
  diacritics, and punctuation. Never paraphrase, add, or remove a lexical word. In particular, restore
  spaces and capitalization in names and honorifics when context supports it.
- Translate the utterance naturally into the bridge language in its conversational context. Do not
  translate tokens literally when they form a fixed expression.
- lessonEligible is true only when the item is complete, natural, self-contained, useful for a beginner,
  and has one clear cue. Mark narration, vocabulary fragments, mechanical buildup, dated/offensive forms,
  ambiguous fragments, and obvious ASR errors in qualityFlags and make them ineligible.
- teachingScore is 0-1. Favor routine speech acts and reusable formulaic chunks. Lower the score for
  proper-name substitutions and narrow/context-dependent examples.

Candidates:
${JSON.stringify(candidates, null, 2)}`;

    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [SOURCE_SENTENCE_EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_training_sentences" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return structured output for source sentence extraction");
    }

    const raw = toolInputObject(toolUse.input, "extract_training_sentences");
    const sentences = requireArray(raw.sentences, "sentences") as ExtractedSentenceReference[];
    assertCompleteBatch(candidates, sentences);
    return sentences;
  }
}

export function fallbackExtractSentences(
  input: SentenceExtractionInput,
): ExtractedSentenceReference[] {
  const sourceDocument = FiloDocument.fromJSON(input.source);
  return sourceDocument
    .requireTier<SourceSentencePayload>("sentence")
    .annotations.map((sentence) => {
      const text = sourceDocument.textOf(sentence).trim();
      const fullSentence = looksLikeCompleteUtterance(text);
      const lessonEligible = fullSentence && !looksLikeTranscriptLabel(text);
      return {
        sourceTierId: "sentence" as const,
        sourceAnnotationId: sentence.id,
        text,
        language: canonicalLanguageCode(sentence.payload.language || input.sourceLanguage),
        fullSentence,
        correctedText: text,
        translation: nullToUndefined(
          translationForCandidate(sourceDocument, sentence, input.bridgeLanguage),
        ),
        reason: "deterministic fallback; requires review before publication",
        confidence: 0.4,
        lessonEligible,
        teachingScore: lessonEligible ? 0.4 : 0,
        qualityFlags: lessonEligible ? ["unreviewed_fallback"] : ["fragment_or_narration"],
      };
    });
}

function normalizeExtractorOutput(
  input: SentenceExtractionInput,
  sentences: ExtractedSentenceReference[],
): ExtractedSentenceReference[] {
  const sourceDocument = FiloDocument.fromJSON(input.source);
  const known = new Map(
    sourceDocument
      .requireTier<SourceSentencePayload>("sentence")
      .annotations.map((annotation) => [annotation.id, annotation]),
  );

  const normalized: ExtractedSentenceReference[] = [];
  for (const sentence of sentences) {
    const annotation = known.get(sentence.sourceAnnotationId);
    if (!annotation) continue;
    const reference: ExtractedSentenceReference = {
      sourceTierId: "sentence",
      sourceAnnotationId: annotation.id,
      text: sourceDocument.textOf(annotation),
      language: canonicalLanguageCode(
        sentence.language || annotation.payload.language || input.sourceLanguage,
      ),
      fullSentence: sentence.fullSentence === true,
    };
    const rawText = sourceDocument.textOf(annotation);
    const correctedText = sentence.correctedText?.trim();
    reference.correctedText =
      correctedText && lexicalSignature(correctedText) === lexicalSignature(rawText)
        ? correctedText
        : rawText;
    const translation =
      sentence.translation?.trim() ||
      translationForCandidate(sourceDocument, annotation, input.bridgeLanguage);
    if (translation) reference.translation = translation;
    const reason = sentence.reason?.trim();
    if (reason) reference.reason = reason;
    if (typeof sentence.confidence === "number") {
      reference.confidence = Math.max(0, Math.min(1, sentence.confidence));
    }
    if (typeof sentence.lessonEligible === "boolean") {
      reference.lessonEligible = sentence.lessonEligible;
    }
    if (typeof sentence.teachingScore === "number") {
      reference.teachingScore = Math.max(0, Math.min(1, sentence.teachingScore));
    }
    if (Array.isArray(sentence.qualityFlags)) {
      reference.qualityFlags = sentence.qualityFlags
        .filter((flag): flag is string => typeof flag === "string")
        .map((flag) =>
          flag
            .trim()
            .toLocaleLowerCase()
            .replace(/[^a-z0-9_-]+/gu, "_"),
        )
        .filter(Boolean)
        .slice(0, 8);
    }
    normalized.push(reference);
  }
  return normalized;
}

function sentenceCandidates(sourceDocument: FiloDocument): SentenceCandidate[] {
  const words = sourceDocument.requireTier<SourceWordPayload>("word").annotations;
  const sentences = sourceDocument.requireTier<SourceSentencePayload>("sentence").annotations;
  return sentences.map((sentence, index) => {
    const sentenceWords = words.filter(
      (word) => sentence.start <= word.start && word.end <= sentence.end,
    );
    const previous = sentences[index - 1];
    const next = sentences[index + 1];
    return {
      sourceAnnotationId: sentence.id,
      text: sourceDocument.textOf(sentence),
      language: sentence.payload.language,
      startMs: sentence.payload.startMs,
      endMs: sentence.payload.endMs,
      wordCount: sentenceWords.length,
      words: sentenceWords.map((word) => word.payload.surface),
      ...(previous ? { previousText: sourceDocument.textOf(previous) } : {}),
      ...(next ? { nextText: sourceDocument.textOf(next) } : {}),
    };
  });
}

function coalesceCandidates(candidates: SentenceCandidate[]): {
  representatives: SentenceCandidate[];
  representativeIdByCandidateId: Map<string, string>;
} {
  const groups = new Map<string, SentenceCandidate[]>();
  for (const candidate of candidates) {
    const key = candidateDeduplicationKey(candidate.text);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const representativeIdByCandidateId = new Map<string, string>();
  const representatives: SentenceCandidate[] = [];
  for (const group of groups.values()) {
    const representative = group[0];
    if (!representative) continue;
    representatives.push({ ...representative, occurrenceCount: group.length });
    for (const candidate of group) {
      representativeIdByCandidateId.set(
        candidate.sourceAnnotationId,
        representative.sourceAnnotationId,
      );
    }
  }
  return { representatives, representativeIdByCandidateId };
}

function candidateDeduplicationKey(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function assertCompleteBatch(
  candidates: SentenceCandidate[],
  sentences: ExtractedSentenceReference[],
): void {
  const expected = new Set(candidates.map((candidate) => candidate.sourceAnnotationId));
  const returned = new Set(
    sentences
      .map((sentence) => sentence?.sourceAnnotationId)
      .filter((id): id is string => typeof id === "string"),
  );
  const missing = [...expected].filter((id) => !returned.has(id));
  const unexpected = [...returned].filter((id) => !expected.has(id));
  if (missing.length > 0 || unexpected.length > 0 || returned.size !== candidates.length) {
    throw new Error(
      `Incomplete sentence extraction batch: expected ${candidates.length}, got ${returned.size}; ` +
        `missing=${missing.slice(0, 3).join(",") || "none"}; ` +
        `unexpected=${unexpected.slice(0, 3).join(",") || "none"}`,
    );
  }
}

function lexicalSignature(text: string): string {
  return text
    .normalize("NFD")
    .toLocaleLowerCase()
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function looksLikeCompleteUtterance(text: string): boolean {
  const words = text.match(/[\p{Letter}\p{Mark}\p{Number}]+/gu) ?? [];
  return words.length > 0 && words.length <= 20 && /[.!?…]["'”’)?\]]*$/u.test(text);
}

function looksLikeTranscriptLabel(text: string): boolean {
  return /^(?:unit|lesson|tape|basic sentences?|vocabulary|drill|exercise)\b/iu.test(text.trim());
}

function canonicalLanguageCode(language: string): string {
  const code = language.trim().toLocaleLowerCase().replace(/_/gu, "-").split("-")[0] ?? "";
  const aliases: Record<string, string> = {
    deu: "de",
    eng: "en",
    fra: "fr",
    hun: "hu",
    ita: "it",
    nld: "nl",
    pol: "pl",
    por: "pt",
    rus: "ru",
    spa: "es",
    tur: "tr",
  };
  return aliases[code] ?? code;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()),
  );
  return results;
}

function translationForCandidate(
  sourceDocument: FiloDocument,
  annotation: FiloAnnotation<unknown>,
  bridgeLanguage: string,
): string | null {
  const translation = sourceDocument
    .annotationsAtRange(annotation, { tierIds: [`translation:${bridgeLanguage}`] })
    .find((candidate) => {
      const payload = candidate.payload as Record<string, unknown>;
      return payload.sourceAnnotationId === annotation.id && typeof payload.text === "string";
    });
  const payload = translation?.payload as { text?: string } | undefined;
  return payload?.text ?? null;
}

function nullToUndefined(value: string | null): string | undefined {
  return value ?? undefined;
}
