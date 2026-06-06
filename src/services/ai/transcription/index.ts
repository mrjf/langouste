import { config } from "../../../lib/config.ts";
import { ElevenLabsTranscriptionProvider } from "./elevenlabs-provider.ts";
import type { TranscriptionProvider } from "./provider.ts";

export type {
  TimedTranscript,
  TranscriptionInput,
  TranscriptionProvider,
  TranscriptWord,
} from "./provider.ts";
export { ElevenLabsTranscriptionProvider } from "./elevenlabs-provider.ts";

let _provider: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider {
  if (!_provider) {
    _provider = new ElevenLabsTranscriptionProvider();
    console.log(
      `[Transcription] Provider initialized: ${_provider.name}${_provider.isAvailable() ? "" : " (unavailable — missing credentials)"}`,
    );
  }
  return _provider;
}

export function resetTranscriptionProvider(): void {
  _provider = null;
}

export function defaultTranscriptionModel(): string {
  return config.elevenLabsApiKey ? "scribe_v2" : "";
}
