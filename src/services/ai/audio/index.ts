import { config } from "../../../lib/config.ts";
import type { AudioProvider } from "./provider.ts";
import { ElevenLabsAudioProvider } from "./elevenlabs-provider.ts";
import { NoopAudioProvider } from "./noop-provider.ts";

export type { AudioProvider, AudioSynthesisOptions, AudioSynthesisResult } from "./provider.ts";
export { ElevenLabsAudioProvider } from "./elevenlabs-provider.ts";
export { NoopAudioProvider } from "./noop-provider.ts";

let _provider: AudioProvider | null = null;

export function getAudioProvider(): AudioProvider {
  if (!_provider) {
    switch (config.audioProvider) {
      case "elevenlabs":
        _provider = new ElevenLabsAudioProvider();
        break;
      case "none":
      case "":
        _provider = new NoopAudioProvider();
        break;
      default:
        throw new Error(`Unknown audio provider: ${config.audioProvider}`);
    }
    console.log(
      `[Audio] Provider initialized: ${_provider.name}${_provider.isAvailable() ? "" : " (unavailable — missing credentials)"}`,
    );
  }
  return _provider;
}

/** Reset the cached provider — used by tests. */
export function resetAudioProvider(): void {
  _provider = null;
}
