import { config } from "../../../lib/config.ts";
import type { AudioProvider, AudioSynthesisOptions, AudioSynthesisResult } from "./provider.ts";

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
// eleven_multilingual_v2 supports 29 languages including all of ours.
const DEFAULT_MODEL = "eleven_multilingual_v2";
// "Sarah" — a `premade` voice that works on free + paid plans. (The widely
// quoted default "Rachel" is a `library` voice and 402s on free.) Override
// with ELEVENLABS_VOICE_ID for a specific cloned/professional voice.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const OUTPUT_FORMAT = "mp3_44100_128";

export class ElevenLabsAudioProvider implements AudioProvider {
  readonly name = "elevenlabs";

  isAvailable(): boolean {
    return !!config.elevenLabsApiKey;
  }

  async synthesize(text: string, opts: AudioSynthesisOptions = {}): Promise<AudioSynthesisResult> {
    if (!config.elevenLabsApiKey) {
      throw new Error("ElevenLabs API key not configured");
    }
    const voiceId = opts.voice || config.elevenLabsVoiceId || DEFAULT_VOICE_ID;
    const url = `${ENDPOINT}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULT_MODEL,
        // Note: eleven_multilingual_v2 does NOT accept `language_code` — it
        // auto-detects instead. Only the v3 / turbo / flash v2.5 models take
        // a `language_code` parameter. We pass it only for those.
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs synthesize failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const audio = new Uint8Array(await res.arrayBuffer());
    return { audio, contentType: "audio/mpeg" };
  }
}
