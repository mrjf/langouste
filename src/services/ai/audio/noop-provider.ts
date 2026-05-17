import type {
  AudioProvider,
  AudioSynthesisOptions,
  AudioSynthesisResult,
} from "./provider.ts";

/** Used when no audio provider is configured. Always reports unavailable. */
export class NoopAudioProvider implements AudioProvider {
  readonly name = "noop";
  isAvailable(): boolean {
    return false;
  }
  async synthesize(
    _text: string,
    _opts?: AudioSynthesisOptions,
  ): Promise<AudioSynthesisResult> {
    throw new Error("No audio provider configured (set AUDIO_PROVIDER + provider credentials)");
  }
}
