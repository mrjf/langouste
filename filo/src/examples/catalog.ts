import { FiloDocument } from "../document";
import { annotateAudio } from "../annotators/audio";
import { annotateDictionaryLookups, type DictionaryLookupResult } from "../annotators/dictionary";
import { annotatePhraseBoundaries } from "../annotators/phrases";
import { annotateTranslation } from "../annotators/translation";
import { annotateWords } from "../annotators/tokenizer";
import { articleToFiloDocumentJson, parseNyTimesArticleHtml } from "../newspaper/nytimes";
import type { ByteRange, FiloAnnotation, FiloDocumentJson, WordPayload } from "../types";

export interface FiloExample {
  id: string;
  title: string;
  language: string;
  description: string;
  tags: string[];
  document: FiloDocumentJson;
}

export async function buildExampleCatalog(): Promise<FiloExample[]> {
  return [
    await buildLangousteHungarianExample(),
    await buildEnglishSyntaxExample(),
    await buildArticleExample(),
    await buildTranscriptExample(),
  ];
}

export async function buildCustomAnalysisDocument(
  text: string,
  options: { language?: string } = {},
): Promise<FiloDocumentJson> {
  const language = options.language ?? "en";
  const document = FiloDocument.fromText(text, {
    id: "custom-analysis",
    metadata: {
      title: "Custom analysis",
      language,
      source: "webapp",
    },
  });
  annotateWords(document, { language });
  annotatePhraseBoundaries(document, { language });
  annotateSentences(document);
  await annotateDictionaryLookups(document, {
    language,
    includeMisses: true,
    lookup: async ({ normalized }) => ENGLISH_DEMO_DICTIONARY[normalized] ?? null,
    source: "demo-dictionary",
  });
  annotateResourceLinks(document, "word", {
    source: "custom",
    urlFor: (word) =>
      `https://en.wiktionary.org/wiki/${encodeURIComponent(
        String((word.payload as WordPayload).surface),
      )}`,
  });
  return document.toJSON();
}

export const NYTIMES_FIXTURE_HTML = String.raw`
<!doctype html>
<html>
  <head>
    <title>Layered Reading Tools - The New York Times</title>
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Layered Reading Tools Bring Annotations to Text",
        "datePublished": "2026-06-04T12:00:00Z",
        "author": [{"name": "Filo Demo Desk"}],
        "articleBody": "A small language system maps words, phrases and translations onto one base document.\n\nThe visual editor shows overlapping phrase tiers near dictionary links while readers inspect each span."
      }
    </script>
  </head>
  <body></body>
</html>`;

export async function documentFromArticleHtml(html: string): Promise<FiloDocumentJson> {
  return articleToFiloDocumentJson(parseNyTimesArticleHtml(html), {
    dictionary: ENGLISH_DEMO_DICTIONARY,
  });
}

async function buildLangousteHungarianExample(): Promise<FiloExample> {
  const text =
    "Számos README található szétszórva ebben a könyvtárban. A dictionary view links every word to a durable lexical record.";
  const document = FiloDocument.fromText(text, {
    id: "langouste-hu-readme",
    metadata: {
      title: "Langouste Hungarian dictionary flow",
      language: "hu",
      source: "langouste",
    },
  });
  annotateWords(document, { language: "hu" });
  annotateSentences(document);
  await annotateDictionaryLookups(document, {
    language: "hu",
    includeMisses: true,
    lookup: async ({ normalized, surface }) =>
      HUNGARIAN_DEMO_DICTIONARY[normalized] ??
      HUNGARIAN_DEMO_DICTIONARY[surface.toLocaleLowerCase("hu")] ??
      null,
    source: "wiktionary-demo",
  });

  const sentence = rangeForWords(document, "Számos", "könyvtárban");
  annotateTranslation(document, {
    ...sentence,
    language: "en",
    sourceLanguage: "hu",
    text: "Numerous READMEs can be found scattered throughout this directory.",
    source: "langouste-translation",
    payload: {
      links: [
        {
          label: "Dictionary page",
          url: "#/dictionary/hu/tal%C3%A1lhat%C3%B3",
        },
      ],
    },
  });
  annotateAudio(document, {
    start: 0,
    end: document.byteLength,
    url: "https://media.example.test/langouste-hu-readme.mp3",
    mimeType: "audio/mpeg",
    startMs: 0,
    endMs: 5400,
    source: "tts-demo",
    payload: {
      links: [{ label: "Audio asset", url: "https://media.example.test/langouste-hu-readme.mp3" }],
    },
  });
  addManualPhrase(document, "Számos", "könyvtárban", {
    label: "HU clause",
    phraseType: "clause",
    gloss: "full Hungarian source sentence",
  });
  annotateResourceLinks(document, "word", {
    source: "wiktionary",
    urlFor: (word) =>
      `https://hu.wiktionary.org/wiki/${encodeURIComponent(
        (word.payload as WordPayload).normalized,
      )}`,
  });

  return {
    id: "langouste-hu",
    title: "Langouste Hungarian lookup",
    language: "hu",
    description: "Word, dictionary, translation, audio, and durable lexical links over one text.",
    tags: ["Langouste", "dictionary", "translation", "audio"],
    document: document.toJSON(),
  };
}

async function buildEnglishSyntaxExample(): Promise<FiloExample> {
  const text =
    "The quick brown fox jumps over the lazy dog near the river. The visual editor shows overlapping phrase tiers.";
  const document = FiloDocument.fromText(text, {
    id: "english-overlap",
    metadata: {
      title: "English phrase overlap",
      language: "en",
      source: "syntax-demo",
    },
  });
  annotateWords(document, { language: "en" });
  annotateSentences(document);
  annotatePhraseBoundaries(document, { language: "en" });
  await annotateDictionaryLookups(document, {
    language: "en",
    includeMisses: true,
    lookup: async ({ normalized }) => ENGLISH_DEMO_DICTIONARY[normalized] ?? null,
    source: "demo-dictionary",
  });
  addManualPhrase(document, "fox", "river", {
    label: "VP+PP chain",
    phraseType: "verb-phrase",
    analysis: "Manual overlap showing a larger VP span containing nested PP and NP spans.",
  });
  annotateResourceLinks(document, "phrase", {
    source: "syntax-reference",
    urlFor: (phrase) =>
      `https://en.wikipedia.org/wiki/${encodeURIComponent(
        String((phrase.payload as Record<string, unknown>).phraseType),
      )}`,
  });

  return {
    id: "english-overlap",
    title: "Overlapping NP / VP / PP tiers",
    language: "en",
    description: "Nested and crossing phrase spans, with dictionary entries and reference links.",
    tags: ["NLP", "NP", "VP", "overlap"],
    document: document.toJSON(),
  };
}

async function buildArticleExample(): Promise<FiloExample> {
  return {
    id: "article-fixture",
    title: "NYTimes-style article ingest",
    language: "en",
    description:
      "HTML news article fixture parsed into a Filo document, then annotated with words, phrases, dictionary links, and article sections.",
    tags: ["newspaper", "NYTimes", "scraper", "phrases"],
    document: await documentFromArticleHtml(NYTIMES_FIXTURE_HTML),
  };
}

async function buildTranscriptExample(): Promise<FiloExample> {
  const text =
    "Agent: The document stores byte offsets. User: Can the tiers overlap? Agent: Yes, overlapping annotations are first-class.";
  const document = FiloDocument.fromText(text, {
    id: "audio-transcript",
    metadata: {
      title: "Transcript and speaker tiers",
      language: "en",
      source: "conversation-demo",
    },
  });
  annotateWords(document, { language: "en" });
  annotateSentences(document);
  annotatePhraseBoundaries(document, { language: "en" });
  await annotateDictionaryLookups(document, {
    language: "en",
    includeMisses: true,
    lookup: async ({ normalized }) => ENGLISH_DEMO_DICTIONARY[normalized] ?? null,
    source: "demo-dictionary",
  });
  annotateAudio(document, {
    start: 0,
    end: document.byteLength,
    url: "https://media.example.test/filo-transcript.wav",
    mimeType: "audio/wav",
    startMs: 0,
    endMs: 8300,
    source: "recording-demo",
  });
  addSpeakerSpan(document, "Agent:", "offsets", "Agent");
  addSpeakerSpan(document, "User:", "overlap", "User");
  addSpeakerSpan(document, "Agent:", "first-class", "Agent", 2);

  return {
    id: "transcript",
    title: "Transcript, audio, speakers",
    language: "en",
    description: "Conversation text with speaker spans, audio timing, words, dictionary, and phrases.",
    tags: ["audio", "transcript", "speakers"],
    document: document.toJSON(),
  };
}

function annotateSentences(document: FiloDocument): void {
  document.ensureTier({
    id: "sentence",
    kind: "sentence",
    description: "Sentence spans",
    source: "filo.examples",
  });
  const sentencePattern = /[^.!?]+[.!?]+|[^.!?]+$/gu;
  for (const match of document.text.matchAll(sentencePattern)) {
    const surface = match[0].trim();
    if (!surface) continue;
    const leadingWhitespace = match[0].search(/\S/u);
    const startStringIndex = (match.index ?? 0) + Math.max(leadingWhitespace, 0);
    const endStringIndex = startStringIndex + surface.length;
    document.addAnnotation("sentence", {
      ...document.byteRangeForStringIndices(startStringIndex, endStringIndex),
      payload: {
        label: "sentence",
        surface,
      },
    });
  }
}

function addManualPhrase(
  document: FiloDocument,
  startSurface: string,
  endSurface: string,
  payload: Record<string, unknown>,
): void {
  document.ensureTier({
    id: "phrase",
    kind: "phrase",
    description: "Phrase spans",
    source: "filo.examples",
  });
  const range = rangeForWords(document, startSurface, endSurface);
  document.addAnnotation("phrase", {
    ...range,
    payload,
    source: "manual-demo",
  });
}

function addSpeakerSpan(
  document: FiloDocument,
  startSurface: string,
  endSurface: string,
  speaker: string,
  occurrence = 1,
): void {
  document.ensureTier({
    id: "speaker",
    kind: "custom",
    description: "Speaker turns",
    source: "filo.examples",
  });
  const range = rangeForWords(document, startSurface.replace(/:$/u, ""), endSurface, occurrence);
  document.addAnnotation("speaker", {
    ...range,
    payload: {
      speaker,
      label: speaker,
    },
  });
}

function annotateResourceLinks(
  document: FiloDocument,
  sourceTierId: string,
  options: {
    source: string;
    urlFor: (annotation: FiloAnnotation<unknown>) => string;
  },
): void {
  const sourceTier = document.tier(sourceTierId);
  if (!sourceTier) return;
  document.ensureTier({
    id: `${sourceTierId}:links`,
    kind: "custom",
    description: `External resources for ${sourceTierId} annotations`,
    source: options.source,
  });
  for (const annotation of sourceTier.annotations) {
    document.addAnnotation(`${sourceTierId}:links`, {
      start: annotation.start,
      end: annotation.end,
      payload: {
        label: "link",
        links: [{ label: options.source, url: options.urlFor(annotation) }],
      },
      source: options.source,
    });
  }
}

function rangeForWords(
  document: FiloDocument,
  startSurface: string,
  endSurface: string,
  occurrence = 1,
): ByteRange {
  const words = document.requireTier<WordPayload>("word").annotations;
  const start = findWord(words, startSurface, occurrence);
  const startIndex = words.indexOf(start);
  const end = words
    .slice(startIndex)
    .find((word) => word.payload.surface.toLocaleLowerCase() === endSurface.toLocaleLowerCase());
  if (!end) throw new Error(`Could not find word range: ${startSurface}…${endSurface}`);
  return {
    start: start.start,
    end: end.end,
  };
}

function findWord(
  words: Array<FiloAnnotation<WordPayload>>,
  surface: string,
  occurrence: number,
): FiloAnnotation<WordPayload> {
  let seen = 0;
  for (const word of words) {
    if (word.payload.surface.toLocaleLowerCase() !== surface.toLocaleLowerCase()) continue;
    seen += 1;
    if (seen === occurrence) return word;
  }
  throw new Error(`Could not find word: ${surface}`);
}

const HUNGARIAN_DEMO_DICTIONARY: Record<string, DictionaryLookupResult> = {
  számos: {
    lemma: "számos",
    definitions: ["numerous, many"],
    partOfSpeech: "adjective",
    source: "Wiktionary fixture",
    sourceUrl: "https://hu.wiktionary.org/wiki/sz%C3%A1mos",
  },
  readme: {
    lemma: "README",
    definitions: ["project documentation file"],
    partOfSpeech: "noun",
    source: "Langouste fixture",
  },
  található: {
    lemma: "található",
    definitions: ["can be found, located"],
    partOfSpeech: "adjective",
    source: "Wiktionary fixture",
    sourceUrl: "https://hu.wiktionary.org/wiki/tal%C3%A1lhat%C3%B3",
  },
  szétszórva: {
    lemma: "szétszór",
    definitions: ["scattered, around"],
    partOfSpeech: "adverbial participle",
    source: "Wiktionary fixture",
    sourceUrl: "https://hu.wiktionary.org/wiki/sz%C3%A9tsz%C3%B3rva",
  },
  ebben: {
    lemma: "ez",
    definitions: ["in this"],
    partOfSpeech: "pronoun",
    source: "Wiktionary fixture",
  },
  könyvtárban: {
    lemma: "könyvtár",
    definitions: ["in the directory"],
    partOfSpeech: "noun",
    source: "Wiktionary fixture",
  },
};

const ENGLISH_DEMO_DICTIONARY: Record<string, DictionaryLookupResult> = {
  annotation: {
    lemma: "annotation",
    definitions: ["metadata attached to a span of text"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  annotations: {
    lemma: "annotation",
    definitions: ["metadata attached to spans of text"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  byte: {
    lemma: "byte",
    definitions: ["a unit of digital storage"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  dictionary: {
    lemma: "dictionary",
    definitions: ["a lexical reference mapping words to meanings"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  document: {
    lemma: "document",
    definitions: ["the immutable base text indexed by Filo"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  editor: {
    lemma: "editor",
    definitions: ["an interface for inspecting and changing structured content"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  language: {
    lemma: "language",
    definitions: ["a system of communication"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  layer: {
    lemma: "layer",
    definitions: ["one conceptual level of annotation"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  layered: {
    lemma: "layer",
    definitions: ["arranged in stacked annotation levels"],
    partOfSpeech: "adjective",
    source: "demo dictionary",
  },
  maps: {
    lemma: "map",
    definitions: ["connects one representation to another"],
    partOfSpeech: "verb",
    source: "demo dictionary",
  },
  offset: {
    lemma: "offset",
    definitions: ["a numeric position in the base document"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  offsets: {
    lemma: "offset",
    definitions: ["numeric positions in the base document"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  overlap: {
    lemma: "overlap",
    definitions: ["share part of the same byte range"],
    partOfSpeech: "verb",
    source: "demo dictionary",
  },
  overlapping: {
    lemma: "overlap",
    definitions: ["sharing part of the same byte range"],
    partOfSpeech: "adjective",
    source: "demo dictionary",
  },
  phrase: {
    lemma: "phrase",
    definitions: ["a multi-word constituent or expression"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  phrases: {
    lemma: "phrase",
    definitions: ["multi-word constituents or expressions"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  reader: {
    lemma: "reader",
    definitions: ["a person or interface consuming text"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  shows: {
    lemma: "show",
    definitions: ["makes visible"],
    partOfSpeech: "verb",
    source: "demo dictionary",
  },
  stores: {
    lemma: "store",
    definitions: ["keeps data for later retrieval"],
    partOfSpeech: "verb",
    source: "demo dictionary",
  },
  text: {
    lemma: "text",
    definitions: ["the base string that annotations attach to"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  tier: {
    lemma: "tier",
    definitions: ["a named collection of annotations"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  tiers: {
    lemma: "tier",
    definitions: ["named collections of annotations"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  translations: {
    lemma: "translation",
    definitions: ["renderings of text in another language"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  visual: {
    lemma: "visual",
    definitions: ["represented through sight"],
    partOfSpeech: "adjective",
    source: "demo dictionary",
  },
  word: {
    lemma: "word",
    definitions: ["a lexical item in a text"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
  words: {
    lemma: "word",
    definitions: ["lexical items in a text"],
    partOfSpeech: "noun",
    source: "demo dictionary",
  },
};
