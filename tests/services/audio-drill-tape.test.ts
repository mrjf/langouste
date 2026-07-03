import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FiloDocument, type FiloDocumentJson, type TranslationPayload } from "filo";
import type { AudioProvider } from "../../src/services/ai/audio/provider.ts";
import type { TranslationProvider } from "../../src/services/ai/translation/provider.ts";
import type { TimedTranscript } from "../../src/services/ai/transcription/provider.ts";
import type { Database, SelectOptions } from "../../src/lib/db/types.ts";
import {
  audioAssetId,
  storeAudioAsset,
  type Source,
} from "../../src/services/corpus/audio-assets.ts";
import {
  annotateTopicLessonSourceCards,
  buildLessonTapeFilo,
  buildTopicAudioLesson,
  ClaudeTopicLessonContentGenerator,
  downloadAudioFile,
  renderLessonAudio,
  type TopicLessonContentGenerator,
  type TopicLessonContentInput,
} from "../../src/services/audio-drill-tape/index.ts";
import {
  annotateSourceTranslations,
  annotateTrainingSentences,
  buildSourceTranscriptFilo,
} from "../../src/services/audio-drill-tape/source-filo.ts";
import type { ExtractedSentenceReference } from "../../src/services/audio-drill-tape/sentence-extractor.ts";
import type {
  AudioNormalizationSettings,
  LanguagePayload,
  LessonSegmentPayload,
  LessonTapeMetadata,
  SourcePhrasePayload,
  SourceSentencePayload,
  SourceWordPayload,
  TrainingSentencePayload,
  TopicLessonSourceCardPayload,
} from "../../src/services/audio-drill-tape/types.ts";

describe("Audio drill tape Filo pipeline", () => {
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
      wordPauseMs: 450,
      reviewOffsets: [1],
    });
    const document = FiloDocument.fromJSON(lesson);

    const segments = document.requireTier<LessonSegmentPayload>("lesson.segment").annotations;
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("tts");
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("source");
    expect(segments.map((segment) => segment.payload.audioSource)).toContain("silence");
    expect(document.text).toContain("You will hear an English cue");
    expect(document.text).not.toContain("How do you say");
    expect(document.text).not.toContain("The whole sentence means");
    expect(document.text).not.toContain("Repeat it");
    expect(segments.some((segment) => segment.payload.type === "repeat_prompt")).toBe(false);

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

    const wordPaddingPauses = segments.filter(
      (segment) =>
        segment.payload.type === "pause" &&
        segment.payload.itemLevel === "word" &&
        segment.payload.pauseRole === "padding",
    );
    expect(wordPaddingPauses.length).toBeGreaterThan(0);
    expect(wordPaddingPauses.every((segment) => segment.payload.durationMs === 450)).toBe(true);
    expect(
      segments.some(
        (segment) =>
          segment.payload.type === "pause" &&
          segment.payload.itemLevel === "word" &&
          segment.payload.pauseRole === "response" &&
          segment.payload.durationMs === 1500,
      ),
    ).toBe(true);

    expect(document.requireTier("audio:source").annotations.length).toBeGreaterThan(0);
    expect(document.requireTier("translation:en").annotations.length).toBeGreaterThan(0);
    expect(document.requireTier("translation:hu").annotations.length).toBeGreaterThan(0);

    const trainedWords = document.requireTier("word").annotations;
    expect(trainedWords.map((word) => document.textOf(word))).not.toContain("Hello");
  });

  test("uses the most isolated matching word timing for word-level source audio", async () => {
    const sourceBase = buildSourceTranscriptFilo(isolatedWordTranscript(), {
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
    const sourceDocument = FiloDocument.fromJSON(source);
    const isolatedWord = sourceDocument
      .requireTier<SourceWordPayload>("word")
      .annotations.find(
        (word) => sourceDocument.textOf(word) === "Jó" && word.payload.startMs === 2000,
      );
    expect(isolatedWord).toBeDefined();

    const lesson = await buildLessonTapeFilo(source, new EchoTranslationProvider(), {
      title: "Hungarian Unit 01A",
      sourceLanguage: "hu",
      bridgeLanguage: "en",
      sourceUrl: "https://example.com/hu.mp3",
      maxItems: 1,
      pauseMs: 1500,
      wordPauseMs: 450,
      reviewOffsets: [],
    });
    const document = FiloDocument.fromJSON(lesson);
    const wordSourceSegments = document
      .requireTier<LessonSegmentPayload>("lesson.segment")
      .annotations.filter(
        (segment) =>
          segment.payload.audioSource === "source" &&
          segment.payload.itemLevel === "word" &&
          document.textOf(segment) === "Jó",
      );

    expect(wordSourceSegments.length).toBeGreaterThan(0);
    expect(
      wordSourceSegments.every(
        (segment) => segment.payload.sourceAnnotationId === isolatedWord?.id,
      ),
    ).toBe(true);
    expect(
      wordSourceSegments.every(
        (segment) => segment.payload.sourceStartMs === 2000 && segment.payload.sourceEndMs === 2250,
      ),
    ).toBe(true);
  });

  test("caches source downloads and restores later output paths without refetching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-download-"));
    const originalFetch = globalThis.fetch;
    const originalDataDir = process.env.LANGOUSTE_DATA_DIR;
    process.env.LANGOUSTE_DATA_DIR = join(dir, "data");
    let fetchCalls = 0;
    const url = `https://example.com/audio/${randomUUID()}.mp3`;
    try {
      globalThis.fetch = async () => {
        fetchCalls += 1;
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "audio/mpeg" },
        });
      };

      const firstPath = join(dir, "first.mp3");
      await downloadAudioFile(url, firstPath);
      expect(fetchCalls).toBe(1);
      expect(await readFile(firstPath)).toEqual(Buffer.from([1, 2, 3, 4]));

      const secondPath = join(dir, "second.mp3");
      await downloadAudioFile(url, secondPath);
      expect(fetchCalls).toBe(1);
      expect(await readFile(secondPath)).toEqual(Buffer.from([1, 2, 3, 4]));
    } finally {
      globalThis.fetch = originalFetch;
      restoreDataDir(originalDataDir);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("seeds the source download cache from an existing output file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-download-"));
    const originalFetch = globalThis.fetch;
    const originalDataDir = process.env.LANGOUSTE_DATA_DIR;
    process.env.LANGOUSTE_DATA_DIR = join(dir, "data");
    let fetchCalls = 0;
    const url = `https://example.com/audio/${randomUUID()}.mp3`;
    try {
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("network should not be used");
      };

      const existingPath = join(dir, "existing.mp3");
      await writeFile(existingPath, new Uint8Array([9, 8, 7]));
      await downloadAudioFile(url, existingPath);
      expect(fetchCalls).toBe(0);

      const restoredPath = join(dir, "restored.mp3");
      await downloadAudioFile(url, restoredPath);
      expect(fetchCalls).toBe(0);
      expect(await readFile(restoredPath)).toEqual(Buffer.from([9, 8, 7]));
    } finally {
      globalThis.fetch = originalFetch;
      restoreDataDir(originalDataDir);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("normalizes generated and source clips while leaving silence unfiltered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-render-"));
    try {
      const ffmpegPath = await writeFakeFfmpeg(dir);
      const logPath = join(dir, "ffmpeg.log");
      const sourceAudioPath = join(dir, "source.mp3");
      await writeFile(sourceAudioPath, new Uint8Array([0, 1, 2, 3]));
      const lesson = await fixtureLesson();

      await renderLessonAudio(lesson, {
        sourceAudioPath,
        outputDir: dir,
        audioProvider: new FakeAudioProvider(),
        db: new MemoryDatabase(),
        ffmpegPath,
        normalizeAudio: true,
        targetLufs: -19,
        truePeakDb: -2,
        loudnessRange: 9,
      });

      const calls = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      expect(calls.some((args) => args.includes("-af") && args.join(" ").includes("I=-19"))).toBe(
        true,
      );
      expect(calls.some((args) => args.includes("anullsrc=r=44100:cl=stereo"))).toBe(true);
      expect(
        calls
          .filter((args) => args.includes("anullsrc=r=44100:cl=stereo"))
          .every((args) => !args.includes("-af")),
      ).toBe(true);
      expect(calls.filter((args) => args.includes("-af")).length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("normalizes reusable cached speech clips without synthesizing them again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-render-"));
    try {
      const ffmpegPath = await writeFakeFfmpeg(dir);
      const logPath = join(dir, "ffmpeg.log");
      const sourceAudioPath = join(dir, "source.mp3");
      const db = new MemoryDatabase();
      const audioProvider = new FakeAudioProvider();
      const text = "Remember the answer.";
      const source: Source = {
        type: "tts",
        label: `English for "${text}"`,
        language: "en",
        text,
      };
      await writeFile(sourceAudioPath, new Uint8Array([0, 1, 2, 3]));
      await storeAudioAsset(db, {
        provider: audioProvider.name,
        language: "en",
        text,
        source,
        audio: new Uint8Array([7, 8, 9]),
        contentType: "audio/mpeg",
      });

      await renderLessonAudio(singleTtsLesson(text), {
        sourceAudioPath,
        outputDir: dir,
        audioProvider,
        db,
        ffmpegPath,
        normalizeAudio: true,
      });

      const calls = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      expect(audioProvider.synthesizeCalls).toBe(0);
      expect(
        calls.some((args) => args.includes("-af") && args.join(" ").includes("loudnorm")),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("pads source clip extraction while preserving original source timings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-render-"));
    try {
      const ffmpegPath = await writeFakeFfmpeg(dir);
      const logPath = join(dir, "ffmpeg.log");
      const sourceAudioPath = join(dir, "source.mp3");
      await writeFile(sourceAudioPath, new Uint8Array([1, 2, 3]));

      const rendered = await renderLessonAudio(
        singleSourceLesson("Jó", sourceAudioPath, { sourceStartMs: 100, sourceEndMs: 250 }),
        {
          sourceAudioPath,
          outputDir: dir,
          audioProvider: new FakeAudioProvider(),
          db: new MemoryDatabase(),
          ffmpegPath,
          sourceClipPaddingMs: 75,
        },
      );

      const calls = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      const extractionCall = calls.find(
        (args) => args.includes(sourceAudioPath) && args.includes("-ss"),
      );
      expect(extractionCall).toBeDefined();
      expect(valueAfter(extractionCall ?? [], "-ss")).toBe("0.025");
      expect(valueAfter(extractionCall ?? [], "-t")).toBe("0.300");

      const payload = rendered.lesson.tiers
        .find((tier) => tier.id === "audio:generated")
        ?.annotations.at(0)?.payload;
      expect(payload).toMatchObject({
        sourceStartMs: 100,
        sourceEndMs: 250,
        clipStartMs: 25,
        clipEndMs: 325,
        sourceClipPaddingMs: 75,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("regenerates invalid cached clips before final concat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-audio-render-"));
    try {
      const ffmpegPath = await writeFakeFfmpeg(dir);
      const logPath = join(dir, "ffmpeg.log");
      const sourceAudioPath = join(dir, "source.mp3");
      const db = new MemoryDatabase();
      const text = "Jó";
      const normalization = defaultNormalization();
      const source = sourceClipSource(text, sourceAudioPath, normalization);
      await writeFile(sourceAudioPath, new Uint8Array([1, 2, 3]));
      await storeAudioAsset(db, {
        provider: "source-clip",
        language: "hu",
        text,
        source,
        audio: new Uint8Array([0, 0, 0]),
        contentType: "audio/mpeg",
      });

      await renderLessonAudio(singleSourceLesson(text, sourceAudioPath), {
        sourceAudioPath,
        outputDir: dir,
        audioProvider: new FakeAudioProvider(),
        db,
        ffmpegPath,
        normalizeAudio: true,
      });

      const calls = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      const audioId = audioAssetId({
        provider: "source-clip",
        language: "hu",
        text,
        source,
      });
      const row = await db.selectOne<{ byte_length: number }>("audio_assets", {
        filters: [{ op: "eq", column: "audio_id", value: audioId }],
      });
      expect(row?.byte_length).toBe(4);
      expect(calls.some((args) => args.includes(sourceAudioPath) && args.includes("-ss"))).toBe(
        true,
      );
      expect(calls.some((args) => args.join(" ").includes("dynaudnorm"))).toBe(true);
      expect(calls.some((args) => args.includes("-xerror"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("builds a topic audio lesson with adapted target sentences and base-language explanations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-topic-drill-"));
    try {
      const result = await buildTopicAudioLesson({
        topic: "Market news",
        sourceText: "The central bank kept interest rates unchanged today.",
        sourceLanguage: "en",
        outputDir: dir,
        renderAudio: false,
        learner: {
          targetLanguage: "hu",
          baseLanguage: "en",
          cefrLevel: "A1",
          knownVocabulary: ["ma = today"],
          grammarGaps: ["verb conjugation: present tense"],
        },
        contentGenerator: new FakeTopicLessonContentGenerator(),
      });

      const lesson = FiloDocument.fromJSON(result.lesson);
      const source = FiloDocument.fromJSON(result.source);
      expect(result.source.metadata.corpus).toBe("audio-drill-topic-source");
      expect(result.lesson.metadata.lessonKind).toBe("topic");
      const sourceCards =
        source.requireTier<TopicLessonSourceCardPayload>("topic.source-card").annotations;
      expect(sourceCards).toHaveLength(1);
      expect(source.textOf(sourceCards[0]!)).toBe(
        "The central bank kept interest rates unchanged today.",
      );
      expect(lesson.text).toContain("A bank ma nem változtat.");
      expect(lesson.text).toContain("The bank does not change today.");
      const segments = lesson.requireTier<LessonSegmentPayload>("lesson.segment").annotations;
      expect(segments.length).toBeGreaterThan(15);
      expect(
        segments.filter(
          (segment) => segment.payload.language === "hu" && segment.payload.speechRate === 0.75,
        ).length,
      ).toBeGreaterThanOrEqual(6);
      expect(
        segments.some(
          (segment) =>
            segment.payload.type === "recall_prompt" &&
            lesson.textOf(segment).includes("Translate"),
        ),
      ).toBe(true);
      expect(
        segments.some(
          (segment) =>
            segment.payload.itemLevel === "phrase" && lesson.textOf(segment) === "A bank",
        ),
      ).toBe(true);
      expect(
        segments.some(
          (segment) =>
            segment.payload.type === "explanation" &&
            segment.payload.language === "hu" &&
            lesson.textOf(segment) === "nem változtat",
        ),
      ).toBe(true);
      expect(
        segments.some(
          (segment) =>
            segment.payload.repetitionIndex === 1 && segment.payload.type === "recall_prompt",
        ),
      ).toBe(true);
      expect(lesson.requireTier("topic.sentence").annotations).toHaveLength(1);
      expect(lesson.requireTier("word").annotations.length).toBeGreaterThan(0);
      const translations = lesson.requireTier<TranslationPayload>("translation:en").annotations;
      expect(translations[0]?.payload.text).toBe("The bank does not change today.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("extracts article text before building topic source cards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-topic-article-"));
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `<!doctype html>
          <html>
            <body>
              <nav>Skip to main content Newsletter Search Open Navigation Menu</nav>
              <article>
                <p>Illustration by Lydia Ortiz and Patrick Rafanan
                Save this story Save this story
                Save this story Save this story
                Darwin found sex a mystery.</p>
                <p>The article continues with another useful sentence.</p>
              </article>
            </body>
          </html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    try {
      const result = await buildTopicAudioLesson({
        topic: "Article",
        sourceUrls: [`http://127.0.0.1:${server.port}/article`],
        sourceLanguage: "en",
        outputDir: dir,
        renderAudio: false,
        learner: {
          targetLanguage: "hu",
          baseLanguage: "en",
          cefrLevel: "A1",
        },
        contentGenerator: new FakeTopicLessonContentGenerator(),
      });

      const source = FiloDocument.fromJSON(result.source);
      const sourceCards =
        source.requireTier<TopicLessonSourceCardPayload>("topic.source-card").annotations;
      expect(sourceCards).toHaveLength(2);
      expect(source.text).not.toContain("Skip to main content");
      expect(source.text).not.toContain("Illustration by Lydia Ortiz");
      expect(source.text).not.toContain("Save this story");
      expect(source.textOf(sourceCards[0]!)).toBe("Darwin found sex a mystery.");
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses desired runtime as a source sentence cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "langouste-topic-runtime-cap-"));
    try {
      const result = await buildTopicAudioLesson({
        topic: "Runtime cap",
        sourceText: "One. Two. Three. Four. Five.",
        sourceLanguage: "en",
        outputDir: dir,
        renderAudio: false,
        desiredRuntimeMinutes: 1,
        learner: {
          targetLanguage: "hu",
          baseLanguage: "en",
          cefrLevel: "A1",
        },
        contentGenerator: new FakeTopicLessonContentGenerator(),
      });

      const source = FiloDocument.fromJSON(result.source);
      const sourceCards =
        source.requireTier<TopicLessonSourceCardPayload>("topic.source-card").annotations;
      expect(sourceCards).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("annotates topic source cards from Filo sentence boundaries", () => {
    const document = FiloDocument.fromText("First source sentence. Second source sentence.", {
      id: "topic-source:test",
      metadata: {},
    });

    const cards = annotateTopicLessonSourceCards(document, { language: "en" });

    expect(document.requireTier("sentence").annotations).toHaveLength(2);
    expect(cards).toHaveLength(2);
    expect(document.textOf(cards[0]!)).toBe("First source sentence.");
    expect(cards[0]?.payload.sourceTierId).toBe("sentence");
    expect(cards[1]?.payload.ordinal).toBe(1);
  });

  test("generates topic sentence cards with parallel model calls", async () => {
    let sentenceCallsInFlight = 0;
    let maxSentenceCallsInFlight = 0;
    let totalSentenceCalls = 0;
    const prompts: string[] = [];
    const fakeClient = {
      messages: {
        create: async (request: { messages?: Array<{ content?: unknown }> }) => {
          const prompt = request.messages?.[0]?.content;
          if (typeof prompt === "string") prompts.push(prompt);
          totalSentenceCalls += 1;
          sentenceCallsInFlight += 1;
          maxSentenceCallsInFlight = Math.max(maxSentenceCallsInFlight, sentenceCallsInFlight);
          await Bun.sleep(25);
          sentenceCallsInFlight -= 1;
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                input: {
                  targetText: "Ez egy mondat.",
                  baseTranslation: "This is a sentence.",
                  explanation: "This is a simple sentence.",
                  explanationParts: [
                    { language: "base", text: "This means" },
                    { language: "target", text: "Ez egy mondat." },
                  ],
                  phrases: [
                    {
                      targetText: "Ez",
                      baseTranslation: "This",
                      explanation: "This is the subject.",
                      explanationParts: [
                        { language: "target", text: "Ez" },
                        { language: "base", text: "means this." },
                      ],
                    },
                    {
                      targetText: "egy mondat",
                      baseTranslation: "a sentence",
                      explanation: "This is the noun phrase.",
                      explanationParts: [
                        { language: "target", text: "egy mondat" },
                        { language: "base", text: "means a sentence." },
                      ],
                    },
                  ],
                  quizPrompts: [
                    {
                      prompt: "Translate the sentence.",
                      promptParts: [{ language: "base", text: "Translate the sentence." }],
                      answer: "Ez egy mondat.",
                    },
                    {
                      prompt: "Translate the phrase.",
                      promptParts: [{ language: "base", text: "Translate the phrase." }],
                      answer: "egy mondat",
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };

    const generator = new ClaudeTopicLessonContentGenerator(fakeClient as never);
    const content = await generator.generate({
      topic: "Parallel test",
      sourceText: "One. Two. Three. Four.",
      sourceUrls: [],
      sourceLanguage: "en",
      targetLanguage: "hu",
      baseLanguage: "en",
      cefrLevel: "A1",
      generationModel: "claude-haiku-4-5-20251001",
      extraInformation: "",
      sourceCards: [
        {
          ordinal: 0,
          sourceTierId: "sentence",
          sourceAnnotationId: "s1",
          sourceText: "One.",
          language: "en",
        },
        {
          ordinal: 1,
          sourceTierId: "sentence",
          sourceAnnotationId: "s2",
          sourceText: "Two.",
          language: "en",
        },
        {
          ordinal: 2,
          sourceTierId: "sentence",
          sourceAnnotationId: "s3",
          sourceText: "Three.",
          language: "en",
        },
        {
          ordinal: 3,
          sourceTierId: "sentence",
          sourceAnnotationId: "s4",
          sourceText: "Four.",
          language: "en",
        },
        {
          ordinal: 4,
          sourceTierId: "sentence",
          sourceAnnotationId: "s5",
          sourceText: "Five.",
          language: "en",
        },
        {
          ordinal: 5,
          sourceTierId: "sentence",
          sourceAnnotationId: "s6",
          sourceText: "Six.",
          language: "en",
        },
        {
          ordinal: 6,
          sourceTierId: "sentence",
          sourceAnnotationId: "s7",
          sourceText: "Seven.",
          language: "en",
        },
        {
          ordinal: 7,
          sourceTierId: "sentence",
          sourceAnnotationId: "s8",
          sourceText: "Eight.",
          language: "en",
        },
      ],
      knownVocabulary: [],
      grammarGaps: [],
    });

    expect(content.sentences).toHaveLength(8);
    expect(totalSentenceCalls).toBe(8);
    expect(maxSentenceCallsInFlight).toBe(8);
    expect(prompts[0]).toContain("structured language-learning transcript card");
    expect(prompts[0]).not.toContain("Your output is parsed into Filo transcript annotations");
    expect(prompts[0]).not.toContain("simplify");
    expect(prompts[0]).not.toContain("ElevenLabs");
    expect(prompts[0]).not.toContain("Audio formula");
    expect(prompts[0]).not.toContain("voice");
  });
});

class EchoTranslationProvider implements TranslationProvider {
  async translateTexts(texts: string[], targetLanguage: string): Promise<string[]> {
    return texts.map((text) => `${targetLanguage}:${text}`);
  }
}

class FakeAudioProvider implements AudioProvider {
  readonly name = "fake-audio";
  synthesizeCalls = 0;

  isAvailable(): boolean {
    return true;
  }

  async synthesize(): Promise<{ audio: Uint8Array; contentType: string }> {
    this.synthesizeCalls += 1;
    return { audio: new Uint8Array([4, 5, 6]), contentType: "audio/mpeg" };
  }
}

class FakeTopicLessonContentGenerator implements TopicLessonContentGenerator {
  async generate(_input: TopicLessonContentInput) {
    return {
      title: "Market News",
      sourceSummary: "Central bank rate decision.",
      sentences: [
        {
          targetText: "A bank ma nem változtat.",
          baseTranslation: "The bank does not change today.",
          explanation:
            "A is the definite article. Nem makes the present-tense verb változtat negative.",
          explanationParts: [
            { language: "base", text: "The phrase" },
            { language: "target", text: "nem változtat" },
            { language: "base", text: "is a negative present-tense verb phrase." },
          ],
          phrases: [
            {
              targetText: "A bank",
              baseTranslation: "The bank",
              explanation: "This is the subject phrase.",
              explanationParts: [{ language: "base", text: "This is the subject phrase." }],
            },
            {
              targetText: "ma nem változtat",
              baseTranslation: "does not change today",
              explanation: "This is a present-tense negative verb phrase.",
              explanationParts: [
                { language: "target", text: "ma" },
                { language: "base", text: "means today." },
                { language: "target", text: "nem változtat" },
                { language: "base", text: "means does not change." },
              ],
            },
          ],
          quizPrompts: [
            {
              prompt: "Translate the whole sentence.",
              promptParts: [{ language: "base", text: "Translate the whole sentence." }],
              answer: "A bank ma nem változtat.",
            },
          ],
        },
      ],
    };
  }
}

class MemoryDatabase implements Database {
  private rows = new Map<string, Record<string, unknown>>();

  async select<T = Record<string, unknown>>(_table: string, options?: SelectOptions): Promise<T[]> {
    const row = await this.selectOne<T>(_table, options);
    return row ? [row] : [];
  }

  async selectOne<T = Record<string, unknown>>(
    _table: string,
    options?: SelectOptions,
  ): Promise<T | null> {
    const audioId = options?.filters?.find((filter) => filter.column === "audio_id")?.value;
    return (typeof audioId === "string" ? (this.rows.get(audioId) as T | undefined) : null) ?? null;
  }

  async insert<T = Record<string, unknown>>(
    _table: string,
    row: Record<string, unknown>,
  ): Promise<T> {
    const audioId = String(row.audio_id);
    this.rows.set(audioId, row);
    return row as T;
  }

  async upsert<T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
  ): Promise<T> {
    return this.insert<T>(table, row);
  }

  async update(): Promise<void> {}

  async updateOne<T = Record<string, unknown>>(): Promise<T> {
    throw new Error("not implemented");
  }

  async delete(): Promise<void> {}

  async rpc<T = unknown>(): Promise<T> {
    throw new Error("not implemented");
  }

  async raw<T = Record<string, unknown>>(): Promise<T[]> {
    return [];
  }
}

async function fixtureLesson(): Promise<Awaited<ReturnType<typeof buildLessonTapeFilo>>> {
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
  return buildLessonTapeFilo(source, new EchoTranslationProvider(), {
    title: "Hungarian Unit 01A",
    sourceLanguage: "hu",
    bridgeLanguage: "en",
    sourceUrl: "https://example.com/hu.mp3",
    maxItems: 1,
    pauseMs: 100,
    wordPauseMs: 50,
    reviewOffsets: [],
  });
}

async function writeFakeFfmpeg(dir: string): Promise<string> {
  const scriptPath = join(dir, "fake-ffmpeg.js");
  const logPath = join(dir, "ffmpeg.log");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env bun
const { appendFile, mkdir, readFile, writeFile } = await import("node:fs/promises");
const { dirname } = await import("node:path");
const args = process.argv.slice(2);
await appendFile(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args.at(-1) === "-") {
  const inputIndex = args.indexOf("-i");
  const inputPath = inputIndex === -1 ? "" : args[inputIndex + 1];
  const input = inputPath ? await readFile(inputPath).catch(() => null) : null;
  if (input && input.length === 3 && input.every((byte) => byte === 0)) process.exit(1);
  process.exit(0);
}
const outputPath = args[args.length - 1];
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, new Uint8Array([1, 2, 3, 4]));
`,
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

function singleTtsLesson(text: string): FiloDocumentJson<LessonTapeMetadata> {
  const document = FiloDocument.fromText<LessonTapeMetadata>(text, {
    id: "lesson:fixture",
    metadata: {
      corpus: "audio-drill-tape",
      title: "Fixture lesson",
      sourceDocumentId: "source:fixture",
      sourceLanguage: "hu",
      bridgeLanguage: "en",
      generatedAt: new Date().toISOString(),
    },
  });
  document.ensureTier<LessonSegmentPayload>({
    id: "lesson.segment",
    kind: "custom",
    description: "Fixture lesson segment",
    source: "fixture",
  });
  document.addAnnotation("lesson.segment", {
    start: 0,
    end: document.byteLength,
    source: "fixture",
    payload: {
      segmentId: "seg-1",
      order: 0,
      type: "meaning",
      language: "en",
      audioSource: "tts",
    },
  });
  return document.toJSON();
}

function singleSourceLesson(
  text: string,
  sourceAudioPath: string,
  options: { sourceStartMs?: number; sourceEndMs?: number } = {},
): FiloDocumentJson<LessonTapeMetadata> {
  const sourceStartMs = options.sourceStartMs ?? 0;
  const sourceEndMs = options.sourceEndMs ?? 100;
  const document = FiloDocument.fromText<LessonTapeMetadata>(text, {
    id: "lesson:source-fixture",
    metadata: {
      corpus: "audio-drill-tape",
      title: "Fixture lesson",
      sourceDocumentId: "source:fixture",
      sourceLanguage: "hu",
      bridgeLanguage: "en",
      sourceAudioPath,
      generatedAt: new Date().toISOString(),
    },
  });
  document.ensureTier<LessonSegmentPayload>({
    id: "lesson.segment",
    kind: "custom",
    description: "Fixture lesson segment",
    source: "fixture",
  });
  document.addAnnotation("lesson.segment", {
    start: 0,
    end: document.byteLength,
    source: "fixture",
    payload: {
      segmentId: "seg-source-1",
      order: 0,
      type: "source",
      language: "hu",
      audioSource: "source",
      sourceTierId: "word",
      sourceAnnotationId: "w1",
      sourceStartMs,
      sourceEndMs,
    },
  });
  return document.toJSON();
}

function sourceClipSource(
  text: string,
  sourceAudioPath: string,
  normalization: AudioNormalizationSettings,
): Source {
  return {
    type: "source-audio",
    label: `Hungarian from source "${text}"`,
    language: "hu",
    text,
    uri: sourceAudioPath,
    sourceAudioPath,
    sourceDocumentId: "source:fixture",
    sourceTierId: "word",
    sourceAnnotationId: "w1",
    sourceStartMs: 0,
    sourceEndMs: 100,
    startMs: 0,
    endMs: 100,
    clipStartMs: 0,
    clipEndMs: 180,
    sourceClipPaddingMs: 80,
    normalization,
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function defaultNormalization(): AudioNormalizationSettings {
  return {
    enabled: true,
    targetLufs: -18,
    truePeakDb: -1.5,
    loudnessRange: 11,
    shortClipThresholdMs: 500,
  };
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

function isolatedWordTranscript(): TimedTranscript {
  return {
    text: "Jó napot. Jó. Köszönöm.",
    language: "hun",
    provider: "fixture",
    model: "fixture",
    words: [
      { text: "Jó", startSec: 0.1, endSec: 0.25, type: "word" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "napot", startSec: 0.27, endSec: 0.6, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "Jó", startSec: 2.0, endSec: 2.25, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
      { text: " ", startSec: null, endSec: null, type: "spacing" },
      { text: "Köszönöm", startSec: 4.0, endSec: 4.5, type: "word" },
      { text: ".", startSec: null, endSec: null, type: "punctuation" },
    ],
  };
}

function restoreDataDir(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.LANGOUSTE_DATA_DIR;
  } else {
    process.env.LANGOUSTE_DATA_DIR = value;
  }
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
