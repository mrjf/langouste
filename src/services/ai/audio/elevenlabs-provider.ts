import { config } from "../../../lib/config.ts";
import type { AudioProvider, AudioSynthesisOptions, AudioSynthesisResult } from "./provider.ts";
import {
  EnvVoiceResolver,
  parseVoiceMap,
  type VoiceMap,
  type VoiceResolver,
} from "./voice-resolver.ts";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * Build the env-backed voice map: ELEVENLABS_VOICES, with the legacy
 * single ELEVENLABS_VOICE_ID folded in as the "default" entry when the
 * JSON map doesn't already define one (back-compat).
 */
function buildEnvVoiceMap(): VoiceMap {
  const map = parseVoiceMap(config.elevenLabsVoices);
  if (!map.default && config.elevenLabsVoiceId.trim()) {
    map.default = { voiceId: config.elevenLabsVoiceId.trim() };
  }
  return map;
}

export class ElevenLabsAudioProvider implements AudioProvider {
  readonly name = "elevenlabs";
  private readonly resolver: VoiceResolver;

  /**
   * @param resolver injected for tests; defaults to an env-backed resolver
   *   built from ELEVENLABS_VOICES (+ legacy ELEVENLABS_VOICE_ID). A future
   *   per-user DB-backed resolver can be injected here instead.
   */
  constructor(resolver?: VoiceResolver) {
    this.resolver = resolver ?? new EnvVoiceResolver(buildEnvVoiceMap());
  }

  isAvailable(): boolean {
    return !!config.elevenLabsApiKey;
  }

  async synthesize(text: string, opts: AudioSynthesisOptions = {}): Promise<AudioSynthesisResult> {
    if (!config.elevenLabsApiKey) {
      throw new Error("ElevenLabs API key not configured");
    }

    const language = opts.language ?? "";
    const profile = await this.resolver.resolve(language, {
      voiceOverride: opts.voice,
      userId: opts.userId,
    });

    const url = `${ENDPOINT}/${encodeURIComponent(profile.voiceId)}?output_format=${OUTPUT_FORMAT}`;

    const body: Record<string, unknown> = {
      text,
      model_id: profile.model,
    };
    if (opts.speechRate !== undefined) {
      body.voice_settings = { speed: opts.speechRate };
    }
    // language_code is only accepted by v2.5 models; the resolver returns
    // null for models that don't support it (e.g. eleven_multilingual_v2).
    if (profile.languageCode) {
      body.language_code = profile.languageCode;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `ElevenLabs synthesize failed (voice=${profile.voiceId} model=${profile.model} lang=${profile.languageCode ?? "auto"}): ${res.status} ${errBody.slice(0, 200)}`,
      );
    }

    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, contentType: "audio/mpeg" };
  }
}
