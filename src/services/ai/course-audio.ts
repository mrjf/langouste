import { createHash } from "node:crypto";
import type { CourseLesson } from "../../types/course.ts";
export const audioKey = (language: string, text: string, context = "") =>
  createHash("sha256")
    .update(JSON.stringify([language, text.normalize("NFC").trim(), context]))
    .digest("hex");
export interface AudioItem {
  id: string;
  language: string;
  text: string;
  context: string;
  uses: string[];
  characters: number;
}
export function inventoryAudio(lessons: CourseLesson[]) {
  const items = new Map<string, AudioItem>();
  for (const l of lessons) {
    function add(text: unknown, path: string, context = "") {
      if (typeof text !== "string" || !text.trim()) return;
      if (l.language === "ar-EG" && !/[\u0600-\u06ff]/u.test(text)) return;
      const clean = text.normalize("NFC").trim();
      const id = audioKey(l.language, clean, context);
      const entry = items.get(id) ?? {
        id,
        language: l.language,
        text: clean,
        context,
        uses: [],
        characters: Array.from(clean).length,
      };
      entry.uses.push(`${l.id}:${path}`);
      items.set(id, entry);
    }
    function walk(value: unknown, path: string) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          walk(v, `${path}.${i}`);
        });
        return;
      }
      const o = value as Record<string, unknown>;
      if (typeof o.text === "string") add(o.text, path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    }
    walk(l, "lesson");
    for (const w of l.vocabulary) {
      add(w.term, `vocabulary.${w.id}`, w.semanticConcept ?? "");
    }
    for (const e of l.exercises) {
      for (const c of e.choices ?? [])
        if (e.type === "order" || e.choiceSupport?.[c]) add(c, `choice.${e.id}`);
      if (l.language === "hu" && e.type === "recall")
        for (const a of e.acceptedAnswers) add(a, `answer.${e.id}`);
    }
  }
  return [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export interface AudioProfile {
  voiceId: string;
  model: string;
  dialectVerified: boolean;
  sampleApproved?: boolean;
  reviewedMetadata?: { source: string; modelLanguages: string[]; pricingConfirmed: boolean };
  creditsPerCharacter: number;
  voiceSettings: Record<string, number | boolean>;
  pronunciationDictionaryLocators?: { pronunciation_dictionary_id: string; version_id: string }[];
}
export function generationKey(item: AudioItem, profile: AudioProfile) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: "elevenlabs",
        language: item.language,
        text: item.text,
        context: item.context,
        voiceId: profile.voiceId,
        model: profile.model,
        voiceSettings: Object.fromEntries(
          Object.entries(profile.voiceSettings).sort(([a], [b]) => a.localeCompare(b)),
        ),
        pronunciationDictionaryLocators: profile.pronunciationDictionaryLocators,
        outputFormat: "mp3_44100_128",
      }),
    )
    .digest("hex");
}
export async function generateCourseAudio(item: AudioItem, profile: AudioProfile, key: string) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: item.text,
        model_id: profile.model,
        language_code: item.language === "ar-EG" ? "ar" : "hu",
        voice_settings: profile.voiceSettings,
        pronunciation_dictionary_locators: profile.pronunciationDictionaryLocators,
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  // Do not automatically retry synthesis: a timeout/5xx may already be billable.
  if (!response.ok)
    throw Error(`ElevenLabs HTTP ${response.status}; inspect before explicit retry`);
  if (!response.headers.get("Content-Type")?.startsWith("audio/"))
    throw Error("Unexpected audio response");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 25 * 1024 * 1024) throw Error("Invalid audio size");
  return bytes;
}
