import { describe, expect, test } from "bun:test";
import { FiloDocument } from "../../filo/src/document";
import type { TranslationPayload } from "../../filo/src/types";
import type { TranslationProvider } from "../../src/services/ai/translation/provider.ts";
import type { TimedTranscript } from "../../src/services/ai/transcription/provider.ts";
import { buildLessonTapeFilo } from "../../src/services/pimsleur-tape/lesson-filo.ts";
import {
  annotateSourceTranslations,
  annotateTrainingSentences,
  buildSourceTranscriptFilo,
} from "../../src/services/pimsleur-tape/source-filo.ts";
import type { ExtractedSentenceReference } from "../../src/services/pimsleur-tape/sentence-extractor.ts";
import type {
  LanguagePayload,
  LessonSegmentPayload,
  SourcePhrasePayload,
  SourceSentencePayload,
  SourceWordPayload,
  TrainingSentencePayload,
} from "../../src/services/pimsleur-tape/types.ts";

describe("Pimsleur tape Filo pipeline", () => {
  test("builds a timed source transcript with word, phrase, sentence, language, audio, and translation tiers", async () => {
    const source = buildSourceTranscriptFilo(fixtureTranscript(), {
      title: "Hungarian Unit 01A",
      sourceLanguage: "hu",
      sourceUrl: "https://example.com/hu.mp3",
      phraseMaxWords: 2,
    });
    const translated = await annotateSourceTranslations(
      source,
      new EchoTranslationProvider(),
      "en",
    );
    const withTraining = annotateTrainingSentences(
      translated,
      extractedSentencesFor(translated),
      "en",
    );
    const document = FiloDocument.fromJSON(withTraining);

    expect(document.text).toBe("Jó napot. Hello. Köszönöm szépen.");

    const words = document.requireTier<SourceWordPayload>("word").annotations;
    expect(words.map((word) => word.payload.surface)).toEqual([
      "Jó",
      "napot",
      "Hello",
      "Köszönöm",
      "szépen",
    ]);
    expect(words[0]?.payload).toMatchObject({
      language: "hu",
      startMs: 100,
      endMs: 280,
    });

    const phrases = document.requireTier<SourcePhrasePayload>("phrase").annotations;
    expect(phrases.map((phrase) => document.textOf(phrase))).toEqual([
      "Jó napot",
      "Hello",
      "Köszönöm szépen",
    ]);
    expect(phrases[0]?.payload.wordAnnotationIds).toEqual([words[0]?.id, words[1]?.id]);

    const languageLevels = document
      .requireTier<LanguagePayload>("language")
      .annotations.map((annotation) => annotation.payload.level);
    expect(languageLevels).toContain("word");
    expect(languageLevels).toContain("phrase");
    expect(languageLevels).toContain("sentence");

    const sourceAudio = document.requireTier("audio:source").annotations;
    expect(sourceAudio.some((annotation) => annotation.payload.level === "phrase")).toBe(true);
    expect(sourceAudio.some((annotation) => annotation.payload.startMs === 100)).toBe(true);

    const translations = document.requireTier<TranslationPayload>("translation:en").annotations;
    expect(translations.map((translation) => translation.payload.level)).toContain("word");
    expect(translations.map((translation) => translation.payload.level)).toContain("phrase");
    expect(translations.map((translation) => translation.payload.level)).toContain("sentence");
    expect(translations[0]?.payload.text).toBe("en:Jó");

    const trainingSentences = document.requireTier<TrainingSentencePayload>("training.sentence");
    expect(trainingSentences.annotations.map((sentence) => sentence.payload.language)).toEqual([
      "hu",
      "en",
      "hu",
    ]);
    expect(trainingSentences.annotations.every((sentence) => sentence.payload.fullSentence)).toBe(
      true,
    );
  });

  test("derives an interspersed lesson tape Filo document from the source tiers", async () => {
    const sourceBase = buildSourceTranscriptFilo(fixtureTranscript(), {
      title: "Hungarian Unit 01A",
      sourceLanguage: "hu",
      sourceUrl: "https://example.com/hu.mp3",
      phraseMaxWords: 2,
    });
    const translated = await annotateSourceTranslations(
      sourceBase,
      new EchoTranslationProvider(),
      "en",
    );
    const source = annotateTrainingSentences(translated, extractedSentencesFor(translated), "en");
    const lesson = await buildLessonTapeFilo(source, new EchoTranslationProvider(), {
      title: "Hungarian Unit 01A",
      sourceLanguage: "hu",
      bridgeLanguage: "en",
      sourceUrl: "https://example.com/hu.mp3",
      maxItems: 2,
      pauseMs: 1500,
      reviewOffsets: [1],
    });
    const document = FiloDocument.fromJSON(lesson);

    const segments = document.requireTier<LessonSegmentPayload>("lesson.segment").annotations;
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("tts");
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("source");
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("silence");

    const languages = document
      .requireTier<LanguagePayload>("language")
      .annotations.map((annotation) => annotation.payload.language);
    expect(languages).toContain("en");
    expect(languages).toContain("hu");
    expect(languages).toContain("zxx");

    const sourceSegments = segments.filter((segment) => segment.payload.audioSource === "source");
    expect(sourceSegments.every((segment) => segment.payload.language === "hu")).toBe(true);
    expect(sourceSegments.map((segment) => document.textOf(segment))).not.toContain("Hello");

    const firstSentence = segments.find(
      (segment) => segment.payload.itemLevel === "sentence" && segment.payload.itemId,
    )?.payload.itemId;
    const firstReviewIndex = segments.findIndex(
      (segment) =>
        segment.payload.type === "recall_prompt" && segment.payload.itemId === firstSentence,
    );
    const secondMeaningIndex = segments.findIndex(
      (segment) =>
        segment.payload.type === "meaning" &&
        segment.payload.itemLevel === "sentence" &&
        segment.payload.itemId !== firstSentence,
    );
    expect(firstReviewIndex).toBeGreaterThan(-1);
    expect(secondMeaningIndex).toBeGreaterThan(firstReviewIndex);

    const spaced = document.requireTier("spaced-repetition").annotations;
    expect(spaced.some((annotation) => annotation.payload.phase === "recall_prompt")).toBe(true);
    expect(spaced.some((annotation) => annotation.payload.repetitionIndex === 1)).toBe(true);

    expect(document.requireTier("audio:source").annotations.length).toBeGreaterThan(0);
    expect(document.requireTier("translation:en").annotations.length).toBeGreaterThan(0);
    expect(document.requireTier("translation:hu").annotations.length).toBeGreaterThan(0);

    const trainedWords = document.requireTier("word").annotations;
    expect(trainedWords.map((word) => document.textOf(word))).not.toContain("Hello");
  });
});

class EchoTranslationProvider implements TranslationProvider {
  async translateTexts(texts: string[], targetLanguage: string): Promise<string[]> {
    return texts.map((text) => `${targetLanguage}:${text}`);
  }
}

function fixtureTranscript(): TimedTranscript {
  return {
    text: "Jó napot. Hello. Köszönöm szépen.",
    language: "hu",
    provider: "fixture",
    model: "fixture",
    words: [
      { text: "Jó", startSec: 0.1, endSec: 0.28, type: "word" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "napot", startSec: 0.32, endSec: 0.72, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "Hello", startSec: 1.1, endSec: 1.45, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "Köszönöm", startSec: 2.1, endSec: 2.62, type: "word" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "szépen", startSec: 2.7, endSec: 3.2, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
    ],
  };
}

function extractedSentencesFor(
  sourceJson: ReturnType<typeof buildSourceTranscriptFilo>,
): ExtractedSentenceReference[] {
  const document = FiloDocument.fromJSON(sourceJson);
  return document.requireTier<SourceSentencePayload>("sentence").annotations.map((sentence) => {
    const text = document.textOf(sentence);
    return {
      sourceTierId: "sentence",
      sourceAnnotationId: sentence.id,
      text,
      language: text === "Hello." ? "en" : "hu",
      fullSentence: true,
      translation: `en:${text}`,
      confidence: 0.99,
      reason: "fixture",
    };
  });
}
