import type { FiloDocument } from "../document";
import type { AudioPayload, ByteRange, FiloAnnotation } from "../types";

export interface AudioAnnotationInput extends ByteRange {
  url: string;
  mimeType?: string;
  startMs?: number;
  endMs?: number;
  source?: string;
  tierId?: string;
  payload?: Record<string, unknown>;
}

export function annotateAudio(
  document: FiloDocument,
  input: AudioAnnotationInput,
): FiloAnnotation<AudioPayload> {
  const tierId = input.tierId ?? "audio";
  document.ensureTier<AudioPayload>({
    id: tierId,
    kind: "audio",
    description: "Audio links aligned to text byte ranges",
    source: input.source ?? "filo.audio",
  });
  const payload: AudioPayload = {
    url: input.url,
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.endMs !== undefined ? { endMs: input.endMs } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...input.payload,
  };
  return document.addAnnotation<AudioPayload>(tierId, {
    start: input.start,
    end: input.end,
    payload,
  });
}
