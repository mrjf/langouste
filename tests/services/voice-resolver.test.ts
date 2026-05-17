import { describe, expect, test } from "bun:test";
import { EnvVoiceResolver, parseVoiceMap } from "../../src/services/ai/audio/voice-resolver.ts";

describe("parseVoiceMap", () => {
  test("empty string yields empty map", () => {
    expect(parseVoiceMap("")).toEqual({});
    expect(parseVoiceMap("   ")).toEqual({});
  });

  test("parses a valid per-language map", () => {
    const map = parseVoiceMap(
      JSON.stringify({
        hu: { voiceId: "hu-voice", model: "eleven_turbo_v2_5" },
        default: { voiceId: "def-voice" },
      }),
    );
    expect(map.hu).toEqual({
      voiceId: "hu-voice",
      model: "eleven_turbo_v2_5",
      languageCode: undefined,
    });
    expect(map.default?.voiceId).toBe("def-voice");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseVoiceMap("{not json")).toThrow(/not valid JSON/);
  });

  test("throws on non-object root", () => {
    expect(() => parseVoiceMap("[1,2]")).toThrow(/must be a JSON object/);
  });

  test("throws when an entry is missing voiceId", () => {
    expect(() => parseVoiceMap(JSON.stringify({ hu: { model: "x" } }))).toThrow(
      /voiceId must be a non-empty string/,
    );
  });
});

describe("EnvVoiceResolver", () => {
  test("Hungarian: resolves configured voice + turbo v2.5 + language_code=hu", async () => {
    const r = new EnvVoiceResolver({
      hu: { voiceId: "hu-native", model: "eleven_turbo_v2_5" },
    });
    const p = await r.resolve("hu");
    expect(p.voiceId).toBe("hu-native");
    expect(p.model).toBe("eleven_turbo_v2_5");
    // v2.5 supports language_code; resolver defaults it to the language.
    expect(p.languageCode).toBe("hu");
  });

  test("unconfigured language falls back to default voice + turbo v2.5 + language_code", async () => {
    const r = new EnvVoiceResolver({ default: { voiceId: "def" } });
    const p = await r.resolve("hu");
    expect(p.voiceId).toBe("def");
    expect(p.model).toBe("eleven_turbo_v2_5");
    expect(p.languageCode).toBe("hu");
  });

  test("no map at all uses the built-in fallback voice", async () => {
    const r = new EnvVoiceResolver({});
    const p = await r.resolve("fr");
    expect(p.voiceId).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(p.model).toBe("eleven_turbo_v2_5");
    expect(p.languageCode).toBe("fr");
  });

  test("multilingual_v2 model never gets language_code (would error upstream)", async () => {
    const r = new EnvVoiceResolver({
      fr: { voiceId: "fr-voice", model: "eleven_multilingual_v2" },
    });
    const p = await r.resolve("fr");
    expect(p.model).toBe("eleven_multilingual_v2");
    expect(p.languageCode).toBeNull();
  });

  test("explicit voiceOverride wins over the map", async () => {
    const r = new EnvVoiceResolver({ hu: { voiceId: "hu-native" } });
    const p = await r.resolve("hu", { voiceOverride: "caller-choice" });
    expect(p.voiceId).toBe("caller-choice");
  });

  test('languageCode:"" force-omits the code on a v2.5 model', async () => {
    const r = new EnvVoiceResolver({
      hu: { voiceId: "v", model: "eleven_turbo_v2_5", languageCode: "" },
    });
    const p = await r.resolve("hu");
    expect(p.languageCode).toBeNull();
  });

  test("explicit languageCode overrides the language key", async () => {
    const r = new EnvVoiceResolver({
      "pt-BR": { voiceId: "v", model: "eleven_turbo_v2_5", languageCode: "pt" },
    });
    const p = await r.resolve("pt-BR");
    expect(p.languageCode).toBe("pt");
  });
});
