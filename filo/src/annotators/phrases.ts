import type { FiloDocument } from "../document";
import type { FiloAnnotation, PhrasePayload, WordPayload } from "../types";

export interface PhraseAnnotatorOptions {
  wordTierId?: string;
  outputTierId?: string;
  language?: string;
  source?: string;
}

interface WordView {
  annotation: FiloAnnotation<WordPayload>;
  normalized: string;
}

interface PhraseMatch {
  start: number;
  end: number;
  head: WordView;
  words: WordView[];
}

const ENGLISH_DETERMINERS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
]);

const ENGLISH_PREPOSITIONS = new Set([
  "about",
  "above",
  "across",
  "after",
  "against",
  "along",
  "among",
  "around",
  "at",
  "before",
  "behind",
  "below",
  "between",
  "by",
  "for",
  "from",
  "in",
  "inside",
  "into",
  "near",
  "of",
  "on",
  "over",
  "through",
  "to",
  "under",
  "with",
]);

const ENGLISH_VERBS = new Set([
  "am",
  "are",
  "be",
  "became",
  "become",
  "bring",
  "brings",
  "build",
  "builds",
  "can",
  "connect",
  "connects",
  "do",
  "does",
  "drive",
  "drives",
  "explain",
  "explains",
  "fall",
  "falls",
  "find",
  "finds",
  "grow",
  "grows",
  "has",
  "have",
  "is",
  "jump",
  "jumps",
  "link",
  "links",
  "make",
  "makes",
  "map",
  "maps",
  "move",
  "moves",
  "push",
  "pushes",
  "said",
  "say",
  "says",
  "show",
  "shows",
  "store",
  "stores",
  "surface",
  "surfaces",
  "was",
  "were",
  "will",
]);

const ENGLISH_NOUN_HINTS = new Set([
  "agent",
  "agents",
  "annotation",
  "annotations",
  "article",
  "articles",
  "city",
  "data",
  "directory",
  "document",
  "documents",
  "dog",
  "editor",
  "example",
  "examples",
  "fox",
  "layer",
  "layers",
  "language",
  "languages",
  "market",
  "model",
  "newsroom",
  "offset",
  "offsets",
  "phrase",
  "phrases",
  "reader",
  "river",
  "sentence",
  "system",
  "text",
  "tier",
  "tiers",
  "token",
  "tokens",
  "translation",
  "translations",
  "user",
  "view",
  "views",
  "word",
  "words",
]);

const ENGLISH_ADJECTIVE_HINTS = new Set([
  "active",
  "base",
  "brown",
  "careful",
  "clean",
  "direct",
  "fast",
  "foreign",
  "interactive",
  "lazy",
  "layered",
  "local",
  "new",
  "overlapping",
  "private",
  "quick",
  "rich",
  "small",
  "synthetic",
  "typed",
  "visual",
]);

export function annotatePhraseBoundaries(
  document: FiloDocument,
  options: PhraseAnnotatorOptions = {},
): Array<FiloAnnotation<PhrasePayload>> {
  const wordTierId = options.wordTierId ?? "word";
  const outputTierId = options.outputTierId ?? "phrase";
  document.ensureTier<PhrasePayload>({
    id: outputTierId,
    kind: "phrase",
    description: "Rule-based phrase boundaries",
    source: options.source ?? "filo.phrases",
  });

  const words = document.requireTier<WordPayload>(wordTierId).annotations.map(toWordView);
  const phrases: Array<FiloAnnotation<PhrasePayload>> = [];

  for (let index = 0; index < words.length; index += 1) {
    const nounPhrase = scanNounPhrase(words, index);
    if (nounPhrase) {
      phrases.push(
        addPhrase(document, outputTierId, nounPhrase.start, nounPhrase.end, {
          label: "NP",
          phraseType: "noun-phrase",
          head: nounPhrase.head.annotation.payload.surface,
          words: nounPhrase.words.map((word) => word.annotation.payload.surface),
        }),
      );
    }

    const prepositionalPhrase = scanPrepositionalPhrase(words, index);
    if (prepositionalPhrase) {
      phrases.push(
        addPhrase(document, outputTierId, prepositionalPhrase.start, prepositionalPhrase.end, {
          label: "PP",
          phraseType: "prepositional-phrase",
          head: prepositionalPhrase.head.annotation.payload.surface,
          words: prepositionalPhrase.words.map((word) => word.annotation.payload.surface),
        }),
      );
    }

    const verbPhrase = scanVerbPhrase(words, index);
    if (verbPhrase) {
      phrases.push(
        addPhrase(document, outputTierId, verbPhrase.start, verbPhrase.end, {
          label: "VP",
          phraseType: "verb-phrase",
          head: verbPhrase.head.annotation.payload.surface,
          words: verbPhrase.words.map((word) => word.annotation.payload.surface),
        }),
      );
    }
  }

  return dedupePhrases(phrases);
}

function addPhrase(
  document: FiloDocument,
  tierId: string,
  start: number,
  end: number,
  payload: PhrasePayload,
): FiloAnnotation<PhrasePayload> {
  return document.addAnnotation<PhrasePayload>(tierId, {
    start,
    end,
    payload,
  });
}

function toWordView(annotation: FiloAnnotation<WordPayload>): WordView {
  return {
    annotation,
    normalized: annotation.payload.normalized.toLocaleLowerCase(annotation.payload.language),
  };
}

function scanNounPhrase(words: WordView[], startIndex: number): PhraseMatch | null {
  let index = startIndex;
  if (isDeterminer(words[index])) index += 1;
  while (isAdjective(words[index]) && words[index + 1]) index += 1;
  const head = words[index];
  if (!head || !isNounish(head)) return null;

  const phraseWords = words.slice(startIndex, index + 1);
  const firstWord = phraseWords[0];
  const lastWord = phraseWords[phraseWords.length - 1];
  if (!firstWord || !lastWord) return null;
  return {
    start: firstWord.annotation.start,
    end: lastWord.annotation.end,
    head: lastWord,
    words: phraseWords,
  };
}

function scanPrepositionalPhrase(words: WordView[], startIndex: number): PhraseMatch | null {
  const preposition = words[startIndex];
  if (!preposition || !isPreposition(preposition)) return null;
  const nounPhrase = scanNounPhrase(words, startIndex + 1);
  if (!nounPhrase) return null;
  const phraseWords = [preposition, ...nounPhrase.words];
  return {
    start: preposition.annotation.start,
    end: nounPhrase.end,
    head: preposition,
    words: phraseWords,
  };
}

function scanVerbPhrase(words: WordView[], startIndex: number): PhraseMatch | null {
  const verb = words[startIndex];
  if (!verb || !isVerbish(verb)) return null;

  let endIndex = startIndex;
  const objectPhrase = scanNounPhrase(words, startIndex + 1);
  if (objectPhrase) {
    endIndex = words.indexOf(objectPhrase.words[objectPhrase.words.length - 1] ?? verb);
  }

  const trailingPhrase = scanPrepositionalPhrase(words, endIndex + 1);
  if (trailingPhrase) {
    endIndex = words.indexOf(trailingPhrase.words[trailingPhrase.words.length - 1] ?? verb);
  }

  const phraseWords = words.slice(startIndex, endIndex + 1);
  const lastWord = phraseWords[phraseWords.length - 1] ?? verb;
  return {
    start: verb.annotation.start,
    end: lastWord.annotation.end,
    head: verb,
    words: phraseWords,
  };
}

function isDeterminer(word: WordView | undefined): boolean {
  return word !== undefined && ENGLISH_DETERMINERS.has(word.normalized);
}

function isPreposition(word: WordView | undefined): boolean {
  return word !== undefined && ENGLISH_PREPOSITIONS.has(word.normalized);
}

function isAdjective(word: WordView | undefined): boolean {
  if (!word) return false;
  return ENGLISH_ADJECTIVE_HINTS.has(word.normalized) || word.normalized.endsWith("ing");
}

function isVerbish(word: WordView | undefined): boolean {
  if (!word) return false;
  return (
    ENGLISH_VERBS.has(word.normalized) ||
    word.normalized.endsWith("ed") ||
    word.normalized.endsWith("ing")
  );
}

function isNounish(word: WordView | undefined): boolean {
  if (!word) return false;
  if (isDeterminer(word) || isPreposition(word) || isVerbish(word)) return false;
  return (
    ENGLISH_NOUN_HINTS.has(word.normalized) ||
    word.normalized.endsWith("tion") ||
    word.normalized.endsWith("ment") ||
    word.normalized.endsWith("er") ||
    word.normalized.endsWith("s")
  );
}

function dedupePhrases(
  phrases: Array<FiloAnnotation<PhrasePayload>>,
): Array<FiloAnnotation<PhrasePayload>> {
  const seen = new Set<string>();
  return phrases.filter((phrase) => {
    const key = `${phrase.start}:${phrase.end}:${phrase.payload.phraseType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
