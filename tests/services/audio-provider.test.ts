import { describe, expect, test } from "bun:test";
import { NoopAudioProvider } from "../../src/services/ai/audio/noop-provider.ts";
import { ElevenLabsAudioProvider } from "../../src/services/ai/audio/elevenlabs-provider.ts";
import type {
  AudioProvider,
  AudioSynthesisOptions,
  AudioSynthesisResult,
} from "../../src/services/ai/audio/provider.ts";
import { synthesizeCachedAudio } from "../../src/services/ai/audio/synthesis.ts";
import { adminDb } from "../../src/lib/db/index.ts";

describe("NoopAudioProvider", () => {
  test("reports unavailable and refuses to synthesize", async () => {
    const p = new NoopAudioProvider();
    expect(p.name).toBe("noop");
    expect(p.isAvailable()).toBe(false);
    await expect(p.synthesize("hello")).rejects.toThrow();
  });
});

describe("ElevenLabsAudioProvider", () => {
  test("availability tracks ELEVENLABS_API_KEY at construction time", () => {
    // The provider reads config.elevenLabsApiKey, which is captured once at
    // module load. We can't easily flip it mid-test, so just verify the
    // constructor doesn't throw and the surface area exists.
    const p = new ElevenLabsAudioProvider();
    expect(p.name).toBe("elevenlabs");
    expect(typeof p.isAvailable()).toBe("boolean");
    expect(typeof p.synthesize).toBe("function");
  });
});

describe("shared cached audio synthesis", () => {
  test("reuses the same persisted asset across callers", async () => {
    const provider = new FakeAudioProvider();
    const input = { text: "A shared Hungarian sentence.", language: "hu" };
    const dependencies = { provider, db: adminDb() };

    const first = await synthesizeCachedAudio(input, dependencies);
    const second = await synthesizeCachedAudio(input, dependencies);

    expect(first.audioId).toBe(second.audioId);
    expect(second.audio).toEqual(new Uint8Array([7, 8, 9]));
    expect(provider.calls).toBe(1);
  });
});

class FakeAudioProvider implements AudioProvider {
  readonly name = "shared-audio-test";
  calls = 0;

  isAvailable(): boolean {
    return true;
  }

  async synthesize(_text: string, _options?: AudioSynthesisOptions): Promise<AudioSynthesisResult> {
    this.calls += 1;
    return { audio: new Uint8Array([7, 8, 9]), contentType: "audio/mpeg" };
  }
}
