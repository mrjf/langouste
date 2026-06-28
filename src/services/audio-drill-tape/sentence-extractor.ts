import { FiloDocument, type FiloAnnotation, type FiloDocumentJson } from "filo";
import { config } from "../../lib/config.ts";
import { languageName } from "../../lib/languages.ts";
import { getAnthropicClient } from "../ai/client.ts";
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
  translation?: string;
  reason?: string;
  confidence?: number;
}

export interface SentenceExtractionInput {
  source: FiloDocumentJson<SourceTranscriptMetadata>;
  sourceLanguage: string;
  bridgeLanguage: string;
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
          },
          required: [
            "sourceAnnotationId",
            "language",
            "fullSentence",
            "translation",
            "reason",
            "confidence",
          ],
        },
      },
    },
    required: ["sentences"],
  },
};

export class ClaudeSourceSentenceExtractor implements SourceSentenceExtractor {
  async extractSentences(input: SentenceExtractionInput): Promise<ExtractedSentenceReference[]> {
    if (config.stubAi) return fallbackExtractSentences(input);

    const sourceDocument = FiloDocument.fromJSON(input.source);
    const candidates = sentenceCandidates(sourceDocument);
    if (candidates.length === 0) return [];

    const sourceLanguageName = languageName(input.sourceLanguage);
    const bridgeLanguageName = languageName(input.bridgeLanguage);
    const prompt = `You are preparing a guided audio-drill language tape from a timed Filo transcript.

Source language: ${sourceLanguageName} (${input.sourceLanguage})
Bridge language: ${bridgeLanguageName} (${input.bridgeLanguage})

Select only complete source-language sentences or complete short utterances for training.
Do not select English narration, labels, titles, vocabulary fragments, isolated words, or partial sentence fragments.
Return every candidate with its language and whether it is a full sentence. Keep sourceAnnotationId exactly as given.

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

    const result = toolUse.input as { sentences?: ExtractedSentenceReference[] };
    return normalizeExtractorOutput(input, result.sentences ?? []);
  }
}

export function fallbackExtractSentences(
  input: SentenceExtractionInput,
): ExtractedSentenceReference[] {
  const sourceDocument = FiloDocument.fromJSON(input.source);
  return sourceDocument
    .requireTier<SourceSentencePayload>("sentence")
    .annotations.map((sentence) => ({
      sourceTierId: "sentence",
      sourceAnnotationId: sentence.id,
      text: sourceDocument.textOf(sentence),
      language: sentence.payload.language || input.sourceLanguage,
      fullSentence: true,
      translation: nullToUndefined(
        translationForCandidate(sourceDocument, sentence, input.bridgeLanguage),
      ),
      reason: "deterministic fallback",
      confidence: 0.5,
    }));
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
      language: sentence.language || annotation.payload.language || input.sourceLanguage,
      fullSentence: sentence.fullSentence === true,
    };
    const translation =
      sentence.translation?.trim() ||
      translationForCandidate(sourceDocument, annotation, input.bridgeLanguage);
    if (translation) reference.translation = translation;
    const reason = sentence.reason?.trim();
    if (reason) reference.reason = reason;
    if (typeof sentence.confidence === "number") {
      reference.confidence = Math.max(0, Math.min(1, sentence.confidence));
    }
    normalized.push(reference);
  }
  return normalized;
}

function sentenceCandidates(sourceDocument: FiloDocument): Array<Record<string, unknown>> {
  const words = sourceDocument.requireTier<SourceWordPayload>("word").annotations;
  return sourceDocument
    .requireTier<SourceSentencePayload>("sentence")
    .annotations.map((sentence) => {
      const sentenceWords = words.filter(
        (word) => sentence.start <= word.start && word.end <= sentence.end,
      );
      return {
        sourceAnnotationId: sentence.id,
        text: sourceDocument.textOf(sentence),
        language: sentence.payload.language,
        startMs: sentence.payload.startMs,
        endMs: sentence.payload.endMs,
        wordCount: sentenceWords.length,
        words: sentenceWords.map((word) => word.payload.surface),
      };
    });
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
