import type {
  ByteRange,
  FiloAnnotation,
  FiloDocument,
  PhrasePayload,
  SentencePayload,
  WordPayload,
} from "filo";
import type { Dimension } from "../profile/dimensions.ts";
import {
  grammarDescriptionForCategory,
  grammarDimensionForCategory,
  normalizeGrammarCategory,
} from "../profile/grammar-ontology.ts";
import {
  grammarReferenceLinks,
  type GrammarReferenceLink,
} from "../references/grammar-reference.ts";

type GrammarLevel = "word" | "phrase" | "sentence";

export interface GrammarPropertyPayload {
  category: string;
  conceptId: string;
  label: string;
  description: string;
  dimension: Dimension;
  language: string;
  level: GrammarLevel;
  sourceTierId: string;
  sourceAnnotationId: string;
  sourceWordAnnotationIds?: string[];
  text: string;
  references: GrammarReferenceLink[];
  detectedBy: string;
}

interface WordView {
  annotation: FiloAnnotation<WordPayload>;
  text: string;
  normalized: string;
}

interface MatchInput {
  range: ByteRange;
  level: GrammarLevel;
  category: string;
  label: string;
  sourceTierId: string;
  sourceAnnotationId: string;
  sourceWordAnnotationIds?: string[];
  confidence?: number;
}

const DETECTOR_ID = "langouste.workbench.grammar-properties";

const QUESTION_WORDS: Record<string, Set<string>> = {
  en: new Set(["who", "what", "when", "where", "why", "how", "which", "whose"]),
  hu: new Set([
    "ki",
    "kik",
    "kit",
    "mit",
    "mi",
    "mikor",
    "hol",
    "hova",
    "honnan",
    "hogyan",
    "hogy",
    "miért",
    "mennyi",
    "melyik",
    "ugye",
  ]),
};

const NEGATION_WORDS: Record<string, Set<string>> = {
  en: new Set(["not", "no", "never", "nothing", "nobody", "nowhere", "cannot", "can't", "won't"]),
  hu: new Set([
    "nem",
    "ne",
    "se",
    "sem",
    "nincs",
    "nincsen",
    "nincsenek",
    "soha",
    "senki",
    "semmi",
  ]),
};

const FIRST_PERSON_WORDS: Record<string, Set<string>> = {
  en: new Set(["i", "me", "my", "mine", "we", "us", "our", "ours"]),
  hu: new Set([
    "én",
    "engem",
    "nekem",
    "velem",
    "hozzám",
    "mi",
    "minket",
    "nekünk",
    "velünk",
    "hozzánk",
  ]),
};

const GREETING_PATTERNS: Record<string, RegExp[]> = {
  en: [/\b(?:hello|hi|hey|good\s+(?:morning|afternoon|evening))\b/giu],
  hu: [/\b(?:szia|sziasztok|helló|hello|üdv|üdvözlet|üdvözlöm|jó\s+(?:reggelt|napot|estét))\b/giu],
};

const FAREWELL_PATTERNS: Record<string, RegExp[]> = {
  en: [/\b(?:goodbye|bye|see\s+you|farewell)\b/giu],
  hu: [/\b(?:viszlát|viszontlátásra|szia|sziasztok|jó\s+éjszakát)\b/giu],
};

const FORMAL_PATTERNS: Record<string, RegExp[]> = {
  en: [/\b(?:sir|madam|please|thank\s+you)\b/giu],
  hu: [
    /\b(?:ön|önt|önnek|önnel|önök|önöket|önöknek|kérem|kérjük|köszönöm|köszönjük|tessék|legyen\s+szíves|szíveskedjen|üdvözlöm|jó\s+(?:napot|estét))\b/giu,
  ],
};

export function annotateGrammarProperties(document: FiloDocument, language: string): void {
  document.ensureTier<GrammarPropertyPayload>({
    id: "grammar",
    kind: "grammar",
    description: "Grammar and pragmatic properties aligned to word, phrase, and sentence spans",
    source: DETECTOR_ID,
  });

  const words = wordViews(document, language);
  const phrases = document.tier<PhrasePayload>("phrase")?.annotations ?? [];
  const sentences = document.tier<SentencePayload>("sentence")?.annotations ?? [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    annotateSentenceProperties(document, language, sentence, words, seen);
  }

  for (const word of words) {
    annotateWordProperties(document, language, word, phrases, sentences, seen);
  }

  annotatePatternProperties(document, language, sentences, words, seen);
}

function annotateSentenceProperties(
  document: FiloDocument,
  language: string,
  sentence: FiloAnnotation<SentencePayload>,
  words: WordView[],
  seen: Set<string>,
): void {
  if (!isInterrogativeSentence(document, sentence, words, language)) return;
  addGrammarProperty(document, language, seen, {
    range: sentence,
    level: "sentence",
    category: "sentence:mood.interrogative",
    label: "Interrogative",
    sourceTierId: sentence.tierId,
    sourceAnnotationId: sentence.id,
    sourceWordAnnotationIds: wordsWithin(sentence, words).map((word) => word.annotation.id),
    confidence: document.textOf(sentence).trimEnd().endsWith("?") ? 0.98 : 0.72,
  });
}

function annotateWordProperties(
  document: FiloDocument,
  language: string,
  word: WordView,
  phrases: Array<FiloAnnotation<PhrasePayload>>,
  sentences: Array<FiloAnnotation<SentencePayload>>,
  seen: Set<string>,
): void {
  if (negationWords(language).has(word.normalized)) {
    addGrammarProperty(document, language, seen, {
      range: word.annotation,
      level: "word",
      category: "u:syntax:negation.placement",
      label: "Negation",
      sourceTierId: word.annotation.tierId,
      sourceAnnotationId: word.annotation.id,
      sourceWordAnnotationIds: [word.annotation.id],
      confidence: 0.96,
    });

    const phrase = smallestContainingSpan(phrases, word.annotation);
    const containingSentence = smallestContainingSpan(sentences, word.annotation);
    const span = phrase ?? containingSentence;
    if (span) {
      addGrammarProperty(document, language, seen, {
        range: span,
        level: phrase ? "phrase" : "sentence",
        category: "u:syntax:negation.placement",
        label: "Negated phrase",
        sourceTierId: span.tierId,
        sourceAnnotationId: span.id,
        sourceWordAnnotationIds: [word.annotation.id],
        confidence: 0.9,
      });
    }
  }

  if (isFirstPersonWord(word, language)) {
    addGrammarProperty(document, language, seen, {
      range: word.annotation,
      level: "word",
      category: "person:first",
      label: "First person",
      sourceTierId: word.annotation.tierId,
      sourceAnnotationId: word.annotation.id,
      sourceWordAnnotationIds: [word.annotation.id],
      confidence: firstPersonWords(language).has(word.normalized) ? 0.98 : 0.68,
    });
  }
}

function annotatePatternProperties(
  document: FiloDocument,
  language: string,
  sentences: Array<FiloAnnotation<SentencePayload>>,
  words: WordView[],
  seen: Set<string>,
): void {
  for (const sentence of sentences) {
    addPatternMatches(document, language, sentence, words, seen, {
      category: "pragmatics:greeting",
      label: "Greeting",
      level: "phrase",
      patterns: greetingPatterns(language),
      confidence: 0.9,
    });
    addPatternMatches(document, language, sentence, words, seen, {
      category: "pragmatics:farewell",
      label: "Farewell",
      level: "phrase",
      patterns: farewellPatterns(language),
      confidence: 0.88,
    });
    addPatternMatches(document, language, sentence, words, seen, {
      category: "formality:register",
      label: "Formal register",
      level: "phrase",
      patterns: formalPatterns(language),
      confidence: 0.82,
    });
  }
}

function addPatternMatches(
  document: FiloDocument,
  language: string,
  sentence: FiloAnnotation<SentencePayload>,
  words: WordView[],
  seen: Set<string>,
  options: {
    category: string;
    label: string;
    level: GrammarLevel;
    patterns: RegExp[];
    confidence: number;
  },
): void {
  const sentenceText = document.textOf(sentence);
  const sentenceStart = document.stringIndexForByteOffset(sentence.start);
  for (const pattern of options.patterns) {
    pattern.lastIndex = 0;
    for (const match of sentenceText.matchAll(pattern)) {
      const matched = match[0];
      const matchIndex = match.index ?? 0;
      const startStringIndex = sentenceStart + matchIndex;
      const endStringIndex = startStringIndex + matched.length;
      const range = document.byteRangeForStringIndices(startStringIndex, endStringIndex);
      const matchedWords = words.filter(
        (word) => range.start <= word.annotation.start && word.annotation.end <= range.end,
      );
      addGrammarProperty(document, language, seen, {
        range,
        level: options.level,
        category: options.category,
        label: options.label,
        sourceTierId: sentence.tierId,
        sourceAnnotationId: sentence.id,
        sourceWordAnnotationIds: matchedWords.map((word) => word.annotation.id),
        confidence: options.confidence,
      });
    }
  }
}

function addGrammarProperty(
  document: FiloDocument,
  language: string,
  seen: Set<string>,
  input: MatchInput,
): void {
  const category = normalizeGrammarCategory(input.category, language);
  if (!category) return;
  const dimension = grammarDimensionForCategory(category, language);
  if (!dimension) return;
  const key = `${input.level}:${category}:${input.range.start}:${input.range.end}:${input.sourceAnnotationId}`;
  if (seen.has(key)) return;
  seen.add(key);
  document.addAnnotation<GrammarPropertyPayload>("grammar", {
    start: input.range.start,
    end: input.range.end,
    kind: "grammar",
    confidence: input.confidence,
    source: DETECTOR_ID,
    payload: {
      category,
      conceptId: conceptIdForGrammarProperty(language, category),
      label: input.label,
      description: grammarDescriptionForCategory(category, language),
      dimension,
      language,
      level: input.level,
      sourceTierId: input.sourceTierId,
      sourceAnnotationId: input.sourceAnnotationId,
      ...(input.sourceWordAnnotationIds?.length
        ? { sourceWordAnnotationIds: input.sourceWordAnnotationIds }
        : {}),
      text: document.textOf(input.range),
      references: grammarReferenceLinks(category, language),
      detectedBy: DETECTOR_ID,
    },
  });
}

function conceptIdForGrammarProperty(language: string, category: string): string {
  return `${language || "und"}:grammar:${category}`;
}

function isInterrogativeSentence(
  document: FiloDocument,
  sentence: FiloAnnotation<SentencePayload>,
  words: WordView[],
  language: string,
): boolean {
  const text = document.textOf(sentence).trim();
  if (text.endsWith("?") || text.endsWith("？")) return true;
  const firstWord = wordsWithin(sentence, words)[0]?.normalized;
  return !!firstWord && questionWords(language).has(firstWord);
}

function isFirstPersonWord(word: WordView, language: string): boolean {
  if (firstPersonWords(language).has(word.normalized)) return true;
  if (language !== "hu") return false;
  if (word.normalized.length < 4) return false;
  if (/(?:ok|ek|ök|om|em|öm|unk|ünk)$/u.test(word.normalized)) {
    return !/(?:napot|estét|reggelt)$/u.test(word.normalized);
  }
  return false;
}

function wordViews(document: FiloDocument, language: string): WordView[] {
  return (document.tier<WordPayload>("word")?.annotations ?? []).map((annotation) => {
    const text = document.textOf(annotation);
    return {
      annotation,
      text,
      normalized: normalizeWord(annotation.payload.normalized || text, language),
    };
  });
}

function normalizeWord(value: string, language: string): string {
  return value
    .replace(/^[^\p{Letter}\p{Mark}\p{Number}]+|[^\p{Letter}\p{Mark}\p{Number}]+$/gu, "")
    .toLocaleLowerCase(language || undefined);
}

function wordsWithin(range: ByteRange, words: WordView[]): WordView[] {
  return words.filter(
    (word) => range.start <= word.annotation.start && word.annotation.end <= range.end,
  );
}

function smallestContainingSpan<Payload>(
  spans: Array<FiloAnnotation<Payload>>,
  range: ByteRange,
): FiloAnnotation<Payload> | null {
  return (
    spans
      .filter((span) => span.start <= range.start && range.end <= span.end)
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
}

function questionWords(language: string): Set<string> {
  return QUESTION_WORDS[language] ?? QUESTION_WORDS.en;
}

function negationWords(language: string): Set<string> {
  return NEGATION_WORDS[language] ?? NEGATION_WORDS.en;
}

function firstPersonWords(language: string): Set<string> {
  return FIRST_PERSON_WORDS[language] ?? FIRST_PERSON_WORDS.en;
}

function greetingPatterns(language: string): RegExp[] {
  return GREETING_PATTERNS[language] ?? GREETING_PATTERNS.en;
}

function farewellPatterns(language: string): RegExp[] {
  return FAREWELL_PATTERNS[language] ?? FAREWELL_PATTERNS.en;
}

function formalPatterns(language: string): RegExp[] {
  return FORMAL_PATTERNS[language] ?? FORMAL_PATTERNS.en;
}
