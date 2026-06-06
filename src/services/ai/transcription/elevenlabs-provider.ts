import { basename } from "node:path";
import { config } from "../../../lib/config.ts";
import type {
  TimedTranscript,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptWord,
} from "./provider.ts";

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const DEFAULT_MODEL = "scribe_v2";

interface ElevenLabsWord {
  text?: string;
  start?: number | null;
  end?: number | null;
  type?: string;
  speaker_id?: string;
  logprob?: number;
  channel_index?: number;
}

interface ElevenLabsTranscriptResponse {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: ElevenLabsWord[];
  transcripts?: Record<string, ElevenLabsTranscriptResponse> | ElevenLabsTranscriptResponse[];
}

export class ElevenLabsTranscriptionProvider implements TranscriptionProvider {
  readonly name = "elevenlabs";

  isAvailable(): boolean {
    return !!config.elevenLabsApiKey;
  }

  async transcribe(input: TranscriptionInput): Promise<TimedTranscript> {
    if (!config.elevenLabsApiKey) {
      throw new Error("ElevenLabs API key not configured");
    }
    if (!input.audioPath && !input.sourceUrl) {
      throw new Error("Transcription requires audioPath or sourceUrl");
    }

    const model = input.model ?? DEFAULT_MODEL;
    const body = new FormData();
    body.append("model_id", model);
    body.append("timestamps_granularity", "word");
    body.append("tag_audio_events", "false");
    body.append("diarize", String(input.diarize ?? false));
    if (input.language) body.append("language_code", input.language);
    if (input.numSpeakers !== undefined) body.append("num_speakers", String(input.numSpeakers));
    for (const keyterm of input.keyterms ?? []) body.append("keyterms", keyterm);

    if (input.audioPath) {
      const file = Bun.file(input.audioPath);
      body.append(
        "file",
        new File([await file.arrayBuffer()], basename(input.audioPath), {
          type: file.type || "audio/mpeg",
        }),
      );
    } else if (input.sourceUrl) {
      body.append("source_url", input.sourceUrl);
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
      },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`ElevenLabs transcription failed: ${res.status} ${errBody.slice(0, 300)}`);
    }

    const raw = (await res.json()) as ElevenLabsTranscriptResponse;
    const normalized = selectTranscript(raw);
    const words = (normalized.words ?? []).map(toTranscriptWord);
    return {
      text: normalized.text ?? words.map((word) => word.text).join(""),
      language: normalized.language_code ?? input.language ?? "und",
      ...(normalized.language_probability !== undefined
        ? { languageProbability: normalized.language_probability }
        : {}),
      words,
      provider: this.name,
      model,
      raw,
    };
  }
}

function selectTranscript(response: ElevenLabsTranscriptResponse): ElevenLabsTranscriptResponse {
  if (!response.transcripts) return response;
  const transcripts = Array.isArray(response.transcripts)
    ? response.transcripts
    : Object.values(response.transcripts);
  return transcripts[0] ?? response;
}

function toTranscriptWord(word: ElevenLabsWord): TranscriptWord {
  return {
    text: word.text ?? "",
    startSec: typeof word.start === "number" ? word.start : null,
    endSec: typeof word.end === "number" ? word.end : null,
    type: transcriptWordType(word.type),
    ...(word.speaker_id !== undefined ? { speakerId: word.speaker_id } : {}),
    ...(word.logprob !== undefined ? { logprob: word.logprob } : {}),
    ...(word.channel_index !== undefined ? { channelIndex: word.channel_index } : {}),
  };
}

function transcriptWordType(value: string | undefined): TranscriptWord["type"] {
  switch (value) {
    case "word":
    case "spacing":
    case "punctuation":
    case "audio_event":
      return value;
    default:
      return "unknown";
  }
}
