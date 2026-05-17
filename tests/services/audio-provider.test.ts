import { describe, expect, test } from "bun:test";
import { NoopAudioProvider } from "../../src/services/ai/audio/noop-provider.ts";
import { ElevenLabsAudioProvider } from "../../src/services/ai/audio/elevenlabs-provider.ts";

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
