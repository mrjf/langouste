import { describe, expect, test } from "bun:test";
import {
  audioKey,
  generationKey,
  inventoryAudio,
  generateCourseAudio,
  type AudioProfile,
} from "../../src/services/ai/course-audio.ts";
import { loadCourseCatalog } from "../../src/services/course/catalog.ts";
const lessons = await loadCourseCatalog();
const inventory = inventoryAudio(lessons);
const profile: AudioProfile = {
  voiceId: "test-voice",
  model: "eleven_v4",
  dialectVerified: true,
  creditsPerCharacter: 1,
  voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
};
describe("course pronunciation assets", () => {
  test("deduplicates target text and preserves semantic senses", () => {
    expect(new Set(inventory.map((i) => i.id)).size).toBe(inventory.length);
    expect(audioKey("hu", "a\u0301")).toBe(audioKey("hu", "á"));
    expect(audioKey("hu", "ma", "today")).not.toBe(audioKey("hu", "ma", "another sense"));
  });
  test("covers readings, canonical vocabulary, examples and Arabic answers without transliteration speech", () => {
    const ids = new Set(inventory.map((i) => i.id));
    for (const l of lessons) {
      for (const r of l.readings)
        for (const s of r.sentences) expect(ids.has(audioKey(l.language, s.text))).toBe(true);
      for (const w of l.vocabulary) {
        expect(ids.has(audioKey(l.language, w.term, w.semanticConcept ?? ""))).toBe(true);
        expect(ids.has(audioKey(l.language, w.example.text))).toBe(true);
      }
      for (const e of l.exercises)
        for (const a of e.answerAtoms ?? [])
          expect(ids.has(audioKey(l.language, a.text))).toBe(true);
    }
    expect(
      inventory.filter((i) => i.language === "ar-EG").every((i) => /[\u0600-\u06ff]/u.test(i.text)),
    ).toBe(true);
  });
  test("generation identity changes with voice settings but not credit pricing or property order", () => {
    const i = inventory[0];
    expect(generationKey(i, profile)).not.toBe(
      generationKey(i, { ...profile, voiceId: "another" }),
    );
    expect(generationKey(i, profile)).toBe(
      generationKey(i, {
        ...profile,
        creditsPerCharacter: 2,
        voiceSettings: { similarity_boost: 0.75, stability: 0.5 },
      }),
    );
  });
  test("provider failure is sanitized and never silently retried", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("private provider error", { status: 429 });
    }) as typeof fetch;
    try {
      await expect(generateCourseAudio(inventory[0], profile, "test-not-a-key")).rejects.toThrow(
        "HTTP 429",
      );
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
