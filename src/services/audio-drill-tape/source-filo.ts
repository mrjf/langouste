import {
  FiloDocument,
  annotateAudio,
  annotateTranslation,
  type FiloAnnotation,
  type FiloDocumentJson,
  type TranslationPayload,
} from "filo";
import type { TranslationProvider } from "../ai/translation/index.ts";
import type { TimedTranscript, TranscriptWord } from "../ai/transcription/index.ts";
import type {
  BuildSourceFiloOptions,
  LanguagePayload,
  SourcePhrasePayload,
  SourceSentencePayload,
  SourceTranscriptMetadata,
  SourceWordPayload,
  TrainingSentencePayload,
} from "./types.ts";
import type { ExtractedSentenceReference } from "./sentence-extractor.ts";

interface TranscriptWordSpan {
  token: TranscriptWord;
  startIndex: number;
  endIndex: number;
  ordinal: number;
}

interface SentenceStringRange {
  startIndex: number;
  endIndex: number;
}

const DEFAULT_PHRASE_MAX_WORDS = 6;
const DEFAULT_PHRASE_PAUSE_MS = 650;
const SENTENCE_TERMINATORS = new Set([".", "!", "?", "…", "。", "！", "？"]);
const SENTENCE_CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "}"]);

export function buildSourceTranscriptFilo(
  transcript: TimedTranscript,
  options: BuildSourceFiloOptions,
): FiloDocumentJson<SourceTranscriptMetadata> {
  const normalized = normalizeTranscriptText(transcript);
  const language = canonicalTranscriptLanguage(transcript.language, options.sourceLanguage);
  const metadata: SourceTranscriptMetadata = {
    corpus: "audio-drill-source-audio",
    title: options.title,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(options.sourceAudioPath ? { sourceAudioPath: options.sourceAudioPath } : {}),
    language,
    transcriptionProvider: transcript.provider,
    transcriptionModel: transcript.model,
    ...(transcript.languageProbability !== undefined
      ? { languageProbability: transcript.languageProbability }
      : {}),
    createdAt: new Date().toISOString(),
  };
  const document = FiloDocument.fromText<SourceTranscriptMetadata>(normalized.text, {
    id: `audio-drill-source:${slugId(options.title)}`,
    metadata,
  });

  document.ensureTier<SourceWordPayload>({
    id: "word",
    kind: "word",
    description: "Word transcript aligned to source audio",
    source: "langouste.audio-drill.transcript",
  });
  document.ensureTier<SourceSentencePayload>({
    id: "sentence",
    kind: "sentence",
    description: "Sentence transcript aligned to source audio",
    source: "langouste.audio-drill.transcript",
  });
  document.ensureTier<SourcePhrasePayload>({
    id: "phrase",
    kind: "phrase",
    description: "Phrase chunks from transcript timing and pauses",
    source: "langouste.audio-drill.transcript",
  });
  document.ensureTier<LanguagePayload>({
    id: "language",
    kind: "language",
    description: "Language used by each transcript segment",
    source: "langouste.audio-drill.transcript",
  });

  if (document.byteLength > 0) {
    annotateAudio(document, {
      start: 0,
      end: document.byteLength,
      tierId: "audio:source",
      url: options.sourceUrl ?? options.sourceAudioPath ?? "",
      mimeType: "audio/mpeg",
      source: "langouste.audio-drill.source",
      payload: {
        level: "document",
        language,
      },
    });
  }

  const wordAnnotations = addWordAnnotations(document, normalized.words, language);
  const sentenceAnnotations = addSentenceAnnotations(document, wordAnnotations, language);
  addPhraseAnnotations(document, sentenceAnnotations, wordAnnotations, language, {
    phraseMaxWords: options.phraseMaxWords ?? DEFAULT_PHRASE_MAX_WORDS,
    phrasePauseMs: options.phrasePauseMs ?? DEFAULT_PHRASE_PAUSE_MS,
  });

  return document.toJSON();
}

export async function annotateSourceTranslations(
  input: FiloDocumentJson<SourceTranscriptMetadata>,
  provider: TranslationProvider,
  targetLanguage: string,
): Promise<FiloDocumentJson<SourceTranscriptMetadata>> {
  const document = FiloDocument.fromJSON(input);
  const sourceLanguage = input.metadata.language;
  const candidates = [
    ...document.requireTier<SourceWordPayload>("word").annotations.map((annotation) => ({
      level: "word",
      annotation,
    })),
    ...document.requireTier<SourcePhrasePayload>("phrase").annotations.map((annotation) => ({
      level: "phrase",
      annotation,
    })),
    ...document.requireTier<SourceSentencePayload>("sentence").annotations.map((annotation) => ({
      level: "sentence",
      annotation,
    })),
  ];

  const texts = candidates.map(({ annotation }) => document.textOf(annotation));
  if (texts.length === 0) return document.toJSON();

  const translations = await provider.translateTexts(
    texts,
    targetLanguage,
    `Translate ${sourceLanguage} transcript items into ${targetLanguage}. Preserve the meaning as a concise language-learning gloss.`,
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const translation = translations[index]?.trim();
    if (!candidate || !translation) continue;
    const payload = candidate.annotation.payload;
    annotateTranslation(document, {
      start: candidate.annotation.start,
      end: candidate.annotation.end,
      language: targetLanguage,
      sourceLanguage,
      text: translation,
      source: "langouste.audio-drill.translation",
      payload: {
        level: candidate.level,
        sourceTierId: candidate.annotation.tierId,
        sourceAnnotationId: candidate.annotation.id,
        originalText: document.textOf(candidate.annotation),
        ...(typeof payload.startMs === "number" ? { startMs: payload.startMs } : {}),
        ...(typeof payload.endMs === "number" ? { endMs: payload.endMs } : {}),
      },
    });
  }

  return document.toJSON();
}

export function annotateTrainingSentences(
  input: FiloDocumentJson<SourceTranscriptMetadata>,
  extracted: ExtractedSentenceReference[],
  bridgeLanguage = "en",
): FiloDocumentJson<SourceTranscriptMetadata> {
  const document = FiloDocument.fromJSON(input);
  document.ensureTier<TrainingSentencePayload>({
    id: "training.sentence",
    kind: "sentence",
    description: "LLM-selected full sentences eligible for source-language training",
    source: "langouste.audio-drill.sentence-extractor",
  });

  const sentenceMap = new Map(
    document
      .requireTier<SourceSentencePayload>("sentence")
      .annotations.map((annotation) => [annotation.id, annotation]),
  );
  const words = document.requireTier<SourceWordPayload>("word").annotations;
  const phrases = document.requireTier<SourcePhrasePayload>("phrase").annotations;

  for (const [ordinal, extractedSentence] of extracted.entries()) {
    const sentence = sentenceMap.get(extractedSentence.sourceAnnotationId);
    if (!sentence) continue;
    const sentenceWords = words.filter(
      (word) => sentence.start <= word.start && word.end <= sentence.end,
    );
    const sentencePhrases = phrases.filter(
      (phrase) => sentence.start <= phrase.start && phrase.end <= sentence.end,
    );
    const payload: TrainingSentencePayload = {
      text: document.textOf(sentence),
      ordinal,
      language: extractedSentence.language,
      wordAnnotationIds: sentenceWords.map((word) => word.id),
      startMs: sentence.payload.startMs,
      endMs: sentence.payload.endMs,
      fullSentence: extractedSentence.fullSentence,
      sourceTierId: sentence.tierId,
      sourceAnnotationId: sentence.id,
      ...(extractedSentence.correctedText
        ? { correctedText: extractedSentence.correctedText }
        : {}),
      ...(extractedSentence.translation ? { translation: extractedSentence.translation } : {}),
      ...(extractedSentence.reason ? { reason: extractedSentence.reason } : {}),
      ...(extractedSentence.lessonEligible !== undefined
        ? { lessonEligible: extractedSentence.lessonEligible }
        : {}),
      ...(extractedSentence.teachingScore !== undefined
        ? { teachingScore: extractedSentence.teachingScore }
        : {}),
      ...(extractedSentence.qualityFlags?.length
        ? { qualityFlags: extractedSentence.qualityFlags }
        : {}),
    };

    const trainingSentence = document.addAnnotation<TrainingSentencePayload>("training.sentence", {
      start: sentence.start,
      end: sentence.end,
      payload,
      ...(extractedSentence.confidence !== undefined
        ? { confidence: extractedSentence.confidence }
        : {}),
      source: "langouste.audio-drill.sentence-extractor",
    });

    addLanguageAnnotation(document, trainingSentence, extractedSentence.language, "sentence");
    for (const phrase of sentencePhrases) {
      addLanguageAnnotation(document, phrase, extractedSentence.language, "phrase");
    }
    for (const word of sentenceWords) {
      addLanguageAnnotation(document, word, extractedSentence.language, "word");
    }

    if (extractedSentence.translation) {
      annotateTranslation(document, {
        start: sentence.start,
        end: sentence.end,
        language: bridgeLanguage,
        sourceLanguage: extractedSentence.language,
        text: extractedSentence.translation,
        source: "langouste.audio-drill.sentence-extractor",
        payload: {
          level: "sentence",
          sourceTierId: sentence.tierId,
          sourceAnnotationId: sentence.id,
          fullSentence: extractedSentence.fullSentence,
        },
      });
    }
  }

  return document.toJSON();
}

const ISO_639_3_TO_1: Record<string, string> = {
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

function canonicalTranscriptLanguage(detected: string, requested: string): string {
  const requestedCode = canonicalLanguageCode(requested);
  const detectedCode = canonicalLanguageCode(detected);
  if (!detectedCode || detectedCode === "und") return requestedCode;
  return detectedCode === requestedCode ? requestedCode : detectedCode;
}

function canonicalLanguageCode(language: string): string {
  const normalized = language.trim().toLocaleLowerCase().replace(/_/gu, "-").split("-")[0] ?? "";
  return ISO_639_3_TO_1[normalized] ?? normalized;
}

export function translationForAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<unknown>,
  targetLanguage: string,
): string | null {
  const translations = document
    .annotationsAtRange(annotation, { tierIds: [`translation:${targetLanguage}`] })
    .filter((candidate): candidate is FiloAnnotation<TranslationPayload> => {
      const payload = candidate.payload as TranslationPayload & Record<string, unknown>;
      return (
        payload.language === targetLanguage &&
        payload.sourceAnnotationId === annotation.id &&
        typeof payload.text === "string"
      );
    });
  return translations[0]?.payload.text ?? null;
}

function addWordAnnotations(
  document: FiloDocument,
  spans: TranscriptWordSpan[],
  language: string,
): Array<FiloAnnotation<SourceWordPayload>> {
  const annotations: Array<FiloAnnotation<SourceWordPayload>> = [];
  for (const span of spans) {
    const range = document.byteRangeForStringIndices(span.startIndex, span.endIndex);
    const startMs = secondsToMs(span.token.startSec);
    const endMs = secondsToMs(span.token.endSec);
    const annotation = document.addAnnotation<SourceWordPayload>("word", {
      ...range,
      payload: {
        surface: document.text.slice(span.startIndex, span.endIndex),
        normalized: document.text.slice(span.startIndex, span.endIndex).toLocaleLowerCase(language),
        ordinal: span.ordinal,
        language,
        startMs,
        endMs,
        ...(span.token.speakerId !== undefined ? { speakerId: span.token.speakerId } : {}),
        ...(span.token.logprob !== undefined ? { logprob: span.token.logprob } : {}),
      },
      ...(span.token.logprob !== undefined ? { confidence: Math.exp(span.token.logprob) } : {}),
      source: "langouste.audio-drill.transcript",
    });
    annotations.push(annotation);
    addLanguageAnnotation(document, annotation, language, "word");
    addSourceAudioAnnotation(document, annotation, language, "word", startMs, endMs);
  }
  return annotations;
}

function addSentenceAnnotations(
  document: FiloDocument,
  words: Array<FiloAnnotation<SourceWordPayload>>,
  language: string,
): Array<FiloAnnotation<SourceSentencePayload>> {
  const annotations: Array<FiloAnnotation<SourceSentencePayload>> = [];
  const sentenceRanges = findSentenceRanges(document.text);
  for (const [ordinal, stringRange] of sentenceRanges.entries()) {
    const range = document.byteRangeForStringIndices(stringRange.startIndex, stringRange.endIndex);
    const sentenceWords = words.filter(
      (word) => range.start <= word.start && word.end <= range.end,
    );
    const timing = timingForWords(sentenceWords);
    const annotation = document.addAnnotation<SourceSentencePayload>("sentence", {
      ...range,
      payload: {
        text: document.text.slice(stringRange.startIndex, stringRange.endIndex),
        ordinal,
        language,
        wordAnnotationIds: sentenceWords.map((word) => word.id),
        startMs: timing.startMs,
        endMs: timing.endMs,
      },
      source: "langouste.audio-drill.transcript",
    });
    annotations.push(annotation);
    addLanguageAnnotation(document, annotation, language, "sentence");
    addSourceAudioAnnotation(
      document,
      annotation,
      language,
      "sentence",
      timing.startMs,
      timing.endMs,
    );
  }
  return annotations;
}

function addPhraseAnnotations(
  document: FiloDocument,
  sentences: Array<FiloAnnotation<SourceSentencePayload>>,
  words: Array<FiloAnnotation<SourceWordPayload>>,
  language: string,
  options: { phraseMaxWords: number; phrasePauseMs: number },
): Array<FiloAnnotation<SourcePhrasePayload>> {
  const annotations: Array<FiloAnnotation<SourcePhrasePayload>> = [];
  let ordinal = 0;
  for (const sentence of sentences) {
    const sentenceWords = words.filter(
      (word) => sentence.start <= word.start && word.end <= sentence.end,
    );
    let chunk: Array<FiloAnnotation<SourceWordPayload>> = [];
    for (const word of sentenceWords) {
      const previous = chunk[chunk.length - 1];
      const pauseMs =
        previous && word.payload.startMs > 0 && previous.payload.endMs > 0
          ? word.payload.startMs - previous.payload.endMs
          : 0;
      if (
        chunk.length > 0 &&
        (chunk.length >= options.phraseMaxWords || pauseMs >= options.phrasePauseMs)
      ) {
        annotations.push(addPhrase(document, chunk, language, ordinal));
        ordinal += 1;
        chunk = [];
      }
      chunk.push(word);
    }
    if (chunk.length > 0) {
      annotations.push(addPhrase(document, chunk, language, ordinal));
      ordinal += 1;
    }
  }
  return annotations;
}

function addPhrase(
  document: FiloDocument,
  words: Array<FiloAnnotation<SourceWordPayload>>,
  language: string,
  ordinal: number,
): FiloAnnotation<SourcePhrasePayload> {
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) throw new Error("Cannot build phrase without words");
  const timing = timingForWords(words);
  const annotation = document.addAnnotation<SourcePhrasePayload>("phrase", {
    start: first.start,
    end: last.end,
    payload: {
      label: document.text.slice(
        document.stringIndexForByteOffset(first.start),
        document.stringIndexForByteOffset(last.end),
      ),
      phraseType: "audio-pause-chunk",
      ordinal,
      language,
      wordAnnotationIds: words.map((word) => word.id),
      words: words.map((word) => word.payload.surface),
      startMs: timing.startMs,
      endMs: timing.endMs,
    },
    source: "langouste.audio-drill.transcript",
  });
  addLanguageAnnotation(document, annotation, language, "phrase");
  addSourceAudioAnnotation(document, annotation, language, "phrase", timing.startMs, timing.endMs);
  return annotation;
}

function addLanguageAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<unknown>,
  language: string,
  level: LanguagePayload["level"],
): void {
  document.addAnnotation<LanguagePayload>("language", {
    start: annotation.start,
    end: annotation.end,
    payload: {
      language,
      level,
      sourceTierId: annotation.tierId,
      sourceAnnotationId: annotation.id,
    },
    source: "langouste.audio-drill.language",
  });
}

function addSourceAudioAnnotation(
  document: FiloDocument,
  annotation: FiloAnnotation<unknown>,
  language: string,
  level: string,
  startMs: number,
  endMs: number,
): void {
  if (startMs < 0 || endMs <= startMs) return;
  annotateAudio(document, {
    start: annotation.start,
    end: annotation.end,
    tierId: "audio:source",
    url:
      (document.metadata as SourceTranscriptMetadata).sourceUrl ??
      (document.metadata as SourceTranscriptMetadata).sourceAudioPath ??
      "",
    mimeType: "audio/mpeg",
    startMs,
    endMs,
    source: "langouste.audio-drill.source",
    payload: {
      level,
      language,
      sourceTierId: annotation.tierId,
      sourceAnnotationId: annotation.id,
    },
  });
}

function normalizeTranscriptText(transcript: TimedTranscript): {
  text: string;
  words: TranscriptWordSpan[];
} {
  const tokens = transcript.words.filter((word) => word.text.length > 0);
  const hasExplicitSpacing = tokens.some(
    (token) => token.type === "spacing" || /^\s+$/u.test(token.text),
  );
  if (hasExplicitSpacing) {
    let text = "";
    const words: TranscriptWordSpan[] = [];
    let ordinal = 0;
    for (const token of tokens) {
      const startIndex = text.length;
      text += token.text;
      const endIndex = text.length;
      if (isWordToken(token)) {
        words.push({ token, startIndex, endIndex, ordinal });
        ordinal += 1;
      }
    }
    return { text: text.trim(), words: trimWordSpans(text, words) };
  }

  const located = locateWordsInText(transcript.text, tokens.filter(isWordToken));
  if (located) return located;

  let text = "";
  const words: TranscriptWordSpan[] = [];
  let ordinal = 0;
  for (const token of tokens.filter(isWordToken)) {
    if (text.length > 0) text += " ";
    const startIndex = text.length;
    text += token.text;
    words.push({ token, startIndex, endIndex: text.length, ordinal });
    ordinal += 1;
  }
  return { text, words };
}

function trimWordSpans(text: string, words: TranscriptWordSpan[]): TranscriptWordSpan[] {
  const leadingTrim = text.length - text.trimStart().length;
  return words.map((word) => ({
    ...word,
    startIndex: Math.max(0, word.startIndex - leadingTrim),
    endIndex: Math.max(0, word.endIndex - leadingTrim),
  }));
}

function locateWordsInText(
  text: string,
  words: TranscriptWord[],
): { text: string; words: TranscriptWordSpan[] } | null {
  if (!text.trim() || words.length === 0) return null;
  let cursor = 0;
  const spans: TranscriptWordSpan[] = [];
  for (let ordinal = 0; ordinal < words.length; ordinal += 1) {
    const word = words[ordinal];
    if (!word) continue;
    const startIndex = text.indexOf(word.text, cursor);
    if (startIndex === -1) return null;
    spans.push({ token: word, startIndex, endIndex: startIndex + word.text.length, ordinal });
    cursor = startIndex + word.text.length;
  }
  return { text: text.trim(), words: trimWordSpans(text, spans) };
}

function isWordToken(token: TranscriptWord): boolean {
  if (token.type === "word") return true;
  if (token.type === "spacing" || /^\s+$/u.test(token.text)) return false;
  return /^[\p{Letter}\p{Mark}\p{Number}]/u.test(token.text);
}

function findSentenceRanges(text: string): SentenceStringRange[] {
  const ranges: SentenceStringRange[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const startIndex = nextNonWhitespace(text, cursor);
    if (startIndex >= text.length) break;
    const endIndex = trimRight(text, sentenceEnd(text, startIndex));
    if (endIndex > startIndex) ranges.push({ startIndex, endIndex });
    cursor = Math.max(endIndex, startIndex + 1);
  }
  return ranges;
}

function nextNonWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function sentenceEnd(text: string, start: number): number {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const char = text[cursor] ?? "";
    if (char === "\n" && text[cursor + 1] === "\n") return cursor;
    if (!SENTENCE_TERMINATORS.has(char)) continue;
    if (char === "." && isDigit(text[cursor - 1]) && isDigit(text[cursor + 1])) continue;
    let end = cursor + 1;
    while (end < text.length && SENTENCE_CLOSERS.has(text[end] ?? "")) end += 1;
    return end;
  }
  return text.length;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && /\p{Number}/u.test(char);
}

function trimRight(text: string, end: number): number {
  let cursor = end;
  while (cursor > 0 && /\s/u.test(text[cursor - 1] ?? "")) cursor -= 1;
  return cursor;
}

function timingForWords(words: Array<FiloAnnotation<SourceWordPayload>>): {
  startMs: number;
  endMs: number;
} {
  const timed = words.filter((word) => word.payload.endMs > word.payload.startMs);
  if (timed.length === 0) return { startMs: -1, endMs: -1 };
  return {
    startMs: Math.min(...timed.map((word) => word.payload.startMs)),
    endMs: Math.max(...timed.map((word) => word.payload.endMs)),
  };
}

function secondsToMs(value: number | null): number {
  return value === null ? -1 : Math.max(0, Math.round(value * 1000));
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "audio";
}
