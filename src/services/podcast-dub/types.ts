export interface PodcastDubMetadata {
  [key: string]: unknown;
  corpus: "podcast-dub";
  title: string;
  sourceDocumentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceUrl?: string;
  sourceAudioPath?: string;
  feedUrl: string;
  episodeTitle: string;
  generatedAt: string;
}

export interface DubSentenceSegment {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  sourceAnnotationId: string;
}

export interface DubParagraph {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  sentences: DubSentenceSegment[];
}
