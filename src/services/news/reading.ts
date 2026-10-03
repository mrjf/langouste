import {
  FiloDocument,
  annotateSentences,
  annotateTranslation,
  annotateWords,
  type FiloAnnotation,
  type FiloDocumentJson,
  type SentencePayload,
  type WordPayload,
} from "filo";
import type { ScrapedArticle } from "../../types/news.ts";
import {
  NEWS_LANGUAGE_OPTIONS,
  type ExplanationPayload,
  type GrammarPayload,
  type ReadingDocumentMetadata,
  type ReadingRequest,
  type VocabularyPayload,
  type WordAlignmentPayload,
} from "../../types/news.ts";
import type { GeneratedLanguageLayer, LayerGenerator, SourceWord } from "../ai/news-layers.ts";

const MAX_SOURCE_CHARACTERS = 12_000;

export async function createReadingDocument(
  article: ScrapedArticle,
  request: ReadingRequest,
  options: { generator: LayerGenerator; maxSentences: number },
): Promise<FiloDocumentJson<ReadingDocumentMetadata>> {
  const source = buildSourceDocument(
    article,
    request,
    options.maxSentences,
    options.generator.model,
  );
  const document = FiloDocument.fromJSON(source);
  const sentenceTier = document.requireTier<SentencePayload>("sentence");
  const wordTier = document.requireTier<WordPayload>("word");
  const sentences = sentenceTier.annotations.map((sentence) => ({
    ordinal: sentence.payload.ordinal,
    text: sentence.payload.text,
    sourceWords: sourceWordsWithin(sentence, wordTier.annotations),
  }));
  const layers = await mapLimit(request.languages, 3, async (language) => {
    const option = NEWS_LANGUAGE_OPTIONS.find((candidate) => candidate.code === language);
    if (!option) throw new Error(`Unsupported language: ${language}`);
    return options.generator.generate({
      title: article.title,
      sourceUrl: article.url,
      sourceLanguage: "en",
      language,
      languageName: option.name,
      level: request.level,
      sentences,
    });
  });
  return addGeneratedLayers(source, layers, request, options.generator.model);
}

export function buildSourceDocument(
  article: ScrapedArticle,
  request: ReadingRequest,
  maxSentences: number,
  model: string,
): FiloDocumentJson<ReadingDocumentMetadata> {
  const bodySentences = selectBodySentences(article.paragraphs, maxSentences - 1);
  const text = [article.title.trim(), ...bodySentences]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SOURCE_CHARACTERS)
    .trim();
  const metadata: ReadingDocumentMetadata = {
    corpus: "langouste-news",
    source: article.source,
    sourceLanguage: "en",
    sourceUrl: article.url,
    readingInput: request.input,
    title: article.title,
    languages: request.languages,
    level: request.level,
    generatedAt: new Date().toISOString(),
    model,
    ...(article.extraction ? { extraction: article.extraction } : {}),
    ...(article.discussionUrl ? { discussionUrl: article.discussionUrl } : {}),
    ...(article.byline ? { byline: article.byline } : {}),
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    ...(article.section ? { section: article.section } : {}),
  };
  const document = FiloDocument.fromText(text, { id: article.id, metadata });
  annotateSentences(document, { language: "en", source: "langouste.news.source" });
  annotateWords(document, { language: "en", source: "langouste.news.source" });
  annotateSections(document);
  return document.toJSON();
}

function addGeneratedLayers(
  source: FiloDocumentJson<ReadingDocumentMetadata>,
  layers: GeneratedLanguageLayer[],
  request: ReadingRequest,
  model: string,
): FiloDocumentJson<ReadingDocumentMetadata> {
  const document = FiloDocument.fromJSON(source);
  const sourceSentences = document.requireTier<SentencePayload>("sentence").annotations;
  const sourceInfo = {
    id: `langouste-news:${model}`,
    kind: "agent" as const,
    label: "Langouste multilingual news adaptation",
    provider: model === "development-stub" ? "stub" : "anthropic",
    version: model,
    generatedAt: new Date().toISOString(),
  };

  for (const layer of layers) {
    const generatedByOrdinal = new Map(
      layer.sentences.map((sentence) => [sentence.ordinal, sentence]),
    );
    const alignmentTierId = `sentence.word-alignment:${layer.language}`;
    const explanationTierId = `sentence.explanation:${layer.language}`;
    const grammarTierId = `sentence.grammar:${layer.language}`;
    const vocabularyTierId = `sentence.vocabulary:${layer.language}`;
    document.ensureTier<WordAlignmentPayload>({
      id: alignmentTierId,
      kind: "parse",
      description: `Target tokens mapped to source-word ordinals for ${layer.language}`,
      source: "langouste.news.word-alignment",
      sourceInfo,
    });
    document.ensureTier<ExplanationPayload>({
      id: explanationTierId,
      kind: "custom",
      description: `English translation notes for ${layer.language}`,
      source: "langouste.news.explanation",
      sourceInfo,
    });
    document.ensureTier<GrammarPayload>({
      id: grammarTierId,
      kind: "grammar",
      description: `Grammar notes for ${layer.language}`,
      source: "langouste.news.grammar",
      sourceInfo,
    });
    document.ensureTier<VocabularyPayload>({
      id: vocabularyTierId,
      kind: "dictionary.lookup",
      description: `Useful vocabulary for ${layer.language}`,
      source: "langouste.news.vocabulary",
      sourceInfo,
    });

    for (const sourceSentence of sourceSentences) {
      const generated = generatedByOrdinal.get(sourceSentence.payload.ordinal);
      if (!generated)
        throw new Error(`Missing ${layer.language} sentence ${sourceSentence.payload.ordinal}`);
      annotateTranslation(document, {
        start: sourceSentence.start,
        end: sourceSentence.end,
        language: layer.language,
        sourceLanguage: "en",
        text: generated.translation,
        tierId: `sentence.translation:${layer.language}`,
        source: "langouste.news.translation",
        sourceInfo,
        payload: { level: request.level, ordinal: sourceSentence.payload.ordinal },
      });
      document.addAnnotation<WordAlignmentPayload>(alignmentTierId, {
        start: sourceSentence.start,
        end: sourceSentence.end,
        payload: {
          language: layer.language,
          ordinal: sourceSentence.payload.ordinal,
          tokens: generated.tokens,
        },
        source: "langouste.news.word-alignment",
        sourceInfo,
      });
      document.addAnnotation<ExplanationPayload>(explanationTierId, {
        start: sourceSentence.start,
        end: sourceSentence.end,
        payload: {
          language: layer.language,
          ordinal: sourceSentence.payload.ordinal,
          text: generated.explanation,
        },
        source: "langouste.news.explanation",
        sourceInfo,
      });
      for (const point of generated.grammar) {
        document.addAnnotation<GrammarPayload>(grammarTierId, {
          start: sourceSentence.start,
          end: sourceSentence.end,
          payload: {
            language: layer.language,
            ordinal: sourceSentence.payload.ordinal,
            label: point.label,
            explanation: point.explanation,
            ...(point.targetText ? { targetText: point.targetText } : {}),
          },
          source: "langouste.news.grammar",
          sourceInfo,
        });
      }
      for (const point of generated.vocabulary) {
        document.addAnnotation<VocabularyPayload>(vocabularyTierId, {
          start: sourceSentence.start,
          end: sourceSentence.end,
          payload: {
            language: layer.language,
            ordinal: sourceSentence.payload.ordinal,
            term: point.term,
            meaning: point.meaning,
            ...(point.partOfSpeech ? { partOfSpeech: point.partOfSpeech } : {}),
          },
          source: "langouste.news.vocabulary",
          sourceInfo,
        });
      }
    }
  }
  return document.toJSON();
}

function sourceWordsWithin(
  sentence: FiloAnnotation<SentencePayload>,
  words: Array<FiloAnnotation<WordPayload>>,
): SourceWord[] {
  return words
    .filter((word) => word.start >= sentence.start && word.end <= sentence.end)
    .map((word, ordinal) => ({ ordinal, text: word.payload.surface }));
}

function annotateSections(document: FiloDocument): void {
  const sentences = document.requireTier<SentencePayload>("sentence").annotations;
  document.ensureTier({
    id: "article:section",
    kind: "custom",
    description: "Headline and body sentence sections",
    source: "langouste.news.source",
  });
  for (const sentence of sentences) {
    document.addAnnotation("article:section", {
      start: sentence.start,
      end: sentence.end,
      payload: {
        label: sentence.payload.ordinal === 0 ? "headline" : "body",
        ordinal: sentence.payload.ordinal,
      },
      source: "langouste.news.source",
    });
  }
}

function selectBodySentences(paragraphs: string[], limit: number): string[] {
  const text = paragraphs.join("\n\n").slice(0, MAX_SOURCE_CHARACTERS);
  if (!text.trim() || limit <= 0) return [];
  const document = FiloDocument.fromText(text);
  return annotateSentences(document, { language: "en" })
    .slice(0, limit)
    .map((annotation) => annotation.payload.text.trim())
    .filter(Boolean);
}

async function mapLimit<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index] as T);
      }
    }),
  );
  return results;
}
