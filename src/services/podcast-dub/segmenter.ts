import { FiloDocument, type FiloDocumentJson } from "filo";
import type { SourceSentencePayload, SourceTranscriptMetadata } from "../audio-drill-tape/index.ts";
import type { DubParagraph, DubSentenceSegment } from "./types.ts";

const DEFAULT_PARAGRAPH_PAUSE_MS = 1500;
// Fluent speakers rarely pause long enough to break paragraphs, so cap length too.
// Keeps each paragraph short enough to replay and to translate in one call.
const MAX_PARAGRAPH_WORDS = 60;

/** Groups consecutive timed sentences into paragraphs, starting a new one after a long pause. */
export function groupIntoParagraphs(
  source: FiloDocumentJson<SourceTranscriptMetadata>,
  paragraphPauseMs = DEFAULT_PARAGRAPH_PAUSE_MS,
): DubParagraph[] {
  const document = FiloDocument.fromJSON(source);
  const sentences = document
    .requireTier<SourceSentencePayload>("sentence")
    .annotations.filter(
      (annotation) =>
        annotation.payload.text.trim().length > 0 &&
        annotation.payload.startMs >= 0 &&
        annotation.payload.endMs > annotation.payload.startMs,
    )
    .toSorted((left, right) => left.payload.ordinal - right.payload.ordinal);

  const paragraphs: DubParagraph[] = [];
  let current: DubSentenceSegment[] = [];
  let previousEndMs: number | null = null;
  let currentWords = 0;

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    paragraphs.push({
      ordinal: paragraphs.length,
      startMs: first.startMs,
      endMs: last.endMs,
      text: current.map((sentence) => sentence.text).join(" "),
      sentences: current,
    });
    current = [];
    currentWords = 0;
  };

  for (const annotation of sentences) {
    const { startMs, endMs } = annotation.payload;
    const text = annotation.payload.text.trim();
    const words = text.split(/\s+/u).length;
    const longPause = previousEndMs !== null && startMs - previousEndMs >= paragraphPauseMs;
    if (longPause || (currentWords > 0 && currentWords + words > MAX_PARAGRAPH_WORDS)) flush();
    current.push({
      ordinal: current.length,
      startMs,
      endMs,
      text,
      sourceAnnotationId: annotation.id,
    });
    previousEndMs = endMs;
    currentWords += words;
  }
  flush();

  return paragraphs;
}
