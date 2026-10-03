import Anthropic from "@anthropic-ai/sdk";
import type { AlignedToken, CefrLevel } from "../../types/news.ts";

export interface GrammarPoint {
  label: string;
  explanation: string;
  targetText?: string;
}

export interface VocabularyPoint {
  term: string;
  meaning: string;
  partOfSpeech?: string;
}

export interface GeneratedSentenceLayer {
  ordinal: number;
  translation: string;
  tokens: AlignedToken[];
  explanation: string;
  grammar: GrammarPoint[];
  vocabulary: VocabularyPoint[];
}

export interface GeneratedLanguageLayer {
  language: string;
  sentences: GeneratedSentenceLayer[];
}

export interface SourceWord {
  ordinal: number;
  text: string;
}

export interface LayerGenerationInput {
  title: string;
  sourceUrl: string;
  sourceLanguage: "en";
  language: string;
  languageName: string;
  level: CefrLevel;
  sentences: Array<{ ordinal: number; text: string; sourceWords: SourceWord[] }>;
}

export interface LayerGenerator {
  readonly model: string;
  generate(input: LayerGenerationInput): Promise<GeneratedLanguageLayer>;
}

export class AnthropicLayerGenerator implements LayerGenerator {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: LayerGenerationInput): Promise<GeneratedLanguageLayer> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 10_000,
          temperature: 0.15,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(input) }],
        });
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        return parseGeneratedLayer(text, input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Language layer generation failed");
  }
}

export class StubLayerGenerator implements LayerGenerator {
  readonly model = "development-stub";

  async generate(input: LayerGenerationInput): Promise<GeneratedLanguageLayer> {
    return {
      language: input.language,
      sentences: input.sentences.map((sentence) => {
        const tokens = tokensForStub(sentence.text, sentence.sourceWords);
        return {
          ordinal: sentence.ordinal,
          translation: renderTokens(tokens),
          tokens,
          explanation:
            "Development stub: configure ANTHROPIC_API_KEY for real multilingual layers.",
          grammar: [],
          vocabulary: [],
        };
      }),
    };
  }
}

const SYSTEM_PROMPT = `You create faithful, level-controlled comprehensible input and cross-language word alignments.

The user sends JSON containing English news sentences, the source words in each sentence numbered from zero, and one target language. Return JSON only with this shape:
{"language":"<code>","sentences":[{"ordinal":0,"tokens":[{"text":"word-or-punctuation","leading":" ","sourceWordOrdinals":[0]}],"explanation":"...","grammar":[{"label":"...","explanation":"...","targetText":"..."}],"vocabulary":[{"term":"...","meaning":"...","partOfSpeech":"..."}]}]}

Rules:
- Return exactly one sentence for every input ordinal and preserve order.
- Translate naturally into the target language at the requested CEFR level. Preserve names, numbers, attribution, uncertainty, and qualifications. Never add facts.
- The translation is reconstructed by concatenating each token's "leading" plus "text".
- Each token must be exactly one orthographic word or one punctuation mark. Put whitespace before it in "leading". Never put whitespace inside "text".
- Align every target word to the zero-based English sourceWordOrdinals it realizes. Several target words may map to one source word and one target word may map to several source words. Grammatical words should align with the source word or construction they help express. Punctuation may use an empty array.
- Keep important technical vocabulary even above the requested level and explain it instead.
- "explanation" is a concise English translation note; use an empty string when none is useful.
- Give at most three concise English grammar notes about structures actually present in the target sentence.
- Give at most four useful target-language vocabulary items with English meanings.
- Use Modern Standard Arabic for Arabic.
- Do not wrap JSON in Markdown.`;

export function parseGeneratedLayer(
  raw: string,
  input: LayerGenerationInput,
): GeneratedLanguageLayer {
  const parsed = JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/iu, "")
      .replace(/\s*```$/u, ""),
  ) as unknown;
  if (!isRecord(parsed) || parsed.language !== input.language || !Array.isArray(parsed.sentences)) {
    throw new Error(`Model returned an invalid ${input.language} layer`);
  }
  const byOrdinal = new Map<number, GeneratedSentenceLayer>();
  for (const candidate of parsed.sentences) {
    if (!isRecord(candidate) || !Number.isInteger(candidate.ordinal)) continue;
    const sourceSentence = input.sentences.find((item) => item.ordinal === candidate.ordinal);
    if (!sourceSentence) continue;
    const tokens = parseTokens(candidate.tokens, sourceSentence.sourceWords.length);
    if (!tokens.length) continue;
    byOrdinal.set(Number(candidate.ordinal), {
      ordinal: Number(candidate.ordinal),
      translation: renderTokens(tokens),
      tokens,
      explanation: stringValue(candidate.explanation),
      grammar: arrayOfRecords(candidate.grammar)
        .map((point) =>
          compact({
            label: stringValue(point.label),
            explanation: stringValue(point.explanation),
            targetText: optionalString(point.targetText),
          }),
        )
        .filter((point) => point.label && point.explanation)
        .slice(0, 3),
      vocabulary: arrayOfRecords(candidate.vocabulary)
        .map((point) =>
          compact({
            term: stringValue(point.term),
            meaning: stringValue(point.meaning),
            partOfSpeech: optionalString(point.partOfSpeech),
          }),
        )
        .filter((point) => point.term && point.meaning)
        .slice(0, 4),
    });
  }
  return {
    language: input.language,
    sentences: input.sentences.map(({ ordinal }) => {
      const sentence = byOrdinal.get(ordinal);
      if (!sentence)
        throw new Error(`Model omitted or malformed ${input.language} sentence ${ordinal}`);
      return sentence;
    }),
  };
}

function parseTokens(value: unknown, sourceWordCount: number): AlignedToken[] {
  const tokens: AlignedToken[] = [];
  for (const candidate of arrayOfRecords(value)) {
    const rawText = stringValue(candidate.text);
    if (!rawText) continue;
    const leading =
      typeof candidate.leading === "string" ? candidate.leading.replace(/[^\s]/gu, "") : "";
    const alignments = Array.isArray(candidate.sourceWordOrdinals)
      ? [
          ...new Set(
            candidate.sourceWordOrdinals.filter(
              (ordinal): ordinal is number =>
                Number.isInteger(ordinal) && ordinal >= 0 && ordinal < sourceWordCount,
            ),
          ),
        ]
      : [];
    appendNormalizedTokens(tokens, rawText, leading, alignments);
  }
  return tokens.map((token, ordinal) => ({ ...token, ordinal }));
}

function appendNormalizedTokens(
  output: AlignedToken[],
  rawText: string,
  initialLeading: string,
  sourceWordOrdinals: number[],
): void {
  let leading = initialLeading;
  for (const part of rawText.split(/(\s+)/gu)) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) {
      leading += part;
      continue;
    }
    const pieces = part.match(
      /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]/gu,
    ) ?? [part];
    for (const piece of pieces) {
      output.push({
        text: piece,
        leading,
        sourceWordOrdinals,
        wordLike: /[\p{L}\p{N}]/u.test(piece),
        ordinal: output.length,
      });
      leading = "";
    }
  }
}

function tokensForStub(text: string, sourceWords: SourceWord[]): AlignedToken[] {
  const sourceByText = sourceWords.map((word) => word.text.toLocaleLowerCase("en"));
  let wordCursor = 0;
  const tokens: AlignedToken[] = [];
  let leading = "";
  for (const part of text.split(/(\s+)/gu)) {
    if (!part) continue;
    if (/^\s+$/u.test(part)) {
      leading += part;
      continue;
    }
    const pieces = part.match(
      /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]/gu,
    ) ?? [part];
    for (const piece of pieces) {
      const wordLike = /[\p{L}\p{N}]/u.test(piece);
      let alignment: number[] = [];
      if (wordLike) {
        const normalized = piece.toLocaleLowerCase("en");
        let index = sourceByText.indexOf(normalized, wordCursor);
        if (index < 0) index = Math.min(wordCursor, Math.max(0, sourceWords.length - 1));
        alignment = sourceWords.length ? [index] : [];
        wordCursor = index + 1;
      }
      tokens.push({
        text: piece,
        leading,
        sourceWordOrdinals: alignment,
        wordLike,
        ordinal: tokens.length,
      });
      leading = "";
    }
  }
  return tokens;
}

export function renderTokens(tokens: AlignedToken[]): string {
  return tokens.map((token) => `${token.leading}${token.text}`).join("");
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) || undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
