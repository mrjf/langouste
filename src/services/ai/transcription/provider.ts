export interface TranscriptWord {
  text: string;
  startSec: number | null;
  endSec: number | null;
  type: "word" | "spacing" | "punctuation" | "audio_event" | "unknown";
  speakerId?: string;
  logprob?: number;
  channelIndex?: number;
}

export interface TimedTranscript {
  text: string;
  language: string;
  languageProbability?: number;
  words: TranscriptWord[];
  provider: string;
  model: string;
  raw?: unknown;
}

export interface TranscriptionInput {
  audioPath?: string;
  sourceUrl?: string;
  language?: string;
  model?: string;
  diarize?: boolean;
  numSpeakers?: number;
  keyterms?: string[];
}

export interface TranscriptionProvider {
  readonly name: string;
  isAvailable(): boolean;
  transcribe(input: TranscriptionInput): Promise<TimedTranscript>;
}
