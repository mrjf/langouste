/**
 * Build a guided audio-drill spaced-repetition tape from source audio.
 *
 * Usage:
 *   bun scripts/build-audio-drill-tape.ts \
 *     --url "https://example.com/unit01.mp3" \
 *     --lang hu \
 *     --out data/audio-drills/hu-unit-01a \
 *     --render-audio
 *
 * Outputs:
 *   transcript.json   normalized word-timestamp transcript
 *   source.filo.json  original source transcript + word/phrase/sentence tiers
 *   lesson.filo.json  generated lesson script + spaced-repetition/audio tiers
 *   *.audio-drill.mp3    final rendered audio, only with --render-audio
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LessonPlanOverride } from "../src/services/audio-drill-tape/types.ts";

loadDotenv();

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.lang || !args.out) {
  console.error(
    "Usage: bun scripts/build-audio-drill-tape.ts --url <mp3-url> --lang <source-language> --out <dir> [--bridge en] [--title <title>] [--transcript <json>] [--lesson-plan <json>] [--target-text-overrides <json>] [--cue-overrides <json>] [--max-items 12] [--pause-ms <fixed-override>] [--review-intervals-ms 25000,120000] [--review-offsets 2,6] [--render-audio] [--no-normalize-audio] [--no-trim-tts-silence] [--target-lufs -18] [--true-peak-db -1.5] [--loudness-range 11] [--short-clip-threshold-ms 500] [--source-clip-padding-ms 80]",
  );
  process.exit(1);
}

const { buildAudioDrillTape } = await import("../src/services/audio-drill-tape/pipeline.ts");

const result = await buildAudioDrillTape({
  sourceUrl: args.url,
  outputDir: args.out,
  sourceLanguage: args.lang,
  bridgeLanguage: args.bridge ?? "en",
  title: args.title,
  transcriptPath: args.transcript,
  renderAudio: args.renderAudio ?? false,
  maxItems: args.maxItems,
  pauseMs: args.pauseMs,
  wordPauseMs: args.wordPauseMs,
  reviewIntervalsMs: args.reviewIntervalsMs,
  reviewOffsets: args.reviewOffsets,
  lessonPlan: args.lessonPlan ? readLessonPlan(args.lessonPlan) : undefined,
  normalizeAudio: args.normalizeAudio,
  targetLufs: args.targetLufs,
  truePeakDb: args.truePeakDb,
  loudnessRange: args.loudnessRange,
  shortClipThresholdMs: args.shortClipThresholdMs,
  sourceClipPaddingMs: args.sourceClipPaddingMs,
  trimTtsSilence: args.trimTtsSilence,
  cueOverrides: args.cueOverrides ? readCueOverrides(args.cueOverrides) : undefined,
  targetTextOverrides: args.targetTextOverrides
    ? readOverrides(args.targetTextOverrides, "--target-text-overrides")
    : undefined,
});

console.log("Wrote:");
console.log(`  transcript: ${result.transcriptPath}`);
console.log(`  source Filo: ${result.sourceFiloPath}`);
console.log(`  lesson Filo: ${result.lessonFiloPath}`);
console.log(`  quality report: ${result.qualityReportPath}`);
if (result.outputAudioPath) console.log(`  audio: ${result.outputAudioPath}`);

interface Args {
  url?: string;
  lang?: string;
  bridge?: string;
  out?: string;
  title?: string;
  transcript?: string;
  maxItems?: number;
  pauseMs?: number;
  wordPauseMs?: number;
  reviewIntervalsMs?: number[];
  reviewOffsets?: number[];
  lessonPlan?: string;
  renderAudio?: boolean;
  normalizeAudio?: boolean;
  targetLufs?: number;
  truePeakDb?: number;
  loudnessRange?: number;
  shortClipThresholdMs?: number;
  sourceClipPaddingMs?: number;
  trimTtsSilence?: boolean;
  cueOverrides?: string;
  targetTextOverrides?: string;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--url":
        index += 1;
        parsed.url = requireValue(argv, index, arg);
        break;
      case "--lang":
      case "--language":
        index += 1;
        parsed.lang = requireValue(argv, index, arg);
        break;
      case "--bridge":
      case "--bridge-language":
        index += 1;
        parsed.bridge = requireValue(argv, index, arg);
        break;
      case "--out":
      case "--output-dir":
        index += 1;
        parsed.out = requireValue(argv, index, arg);
        break;
      case "--title":
        index += 1;
        parsed.title = requireValue(argv, index, arg);
        break;
      case "--transcript":
        index += 1;
        parsed.transcript = requireValue(argv, index, arg);
        break;
      case "--cue-overrides":
        index += 1;
        parsed.cueOverrides = requireValue(argv, index, arg);
        break;
      case "--target-text-overrides":
        index += 1;
        parsed.targetTextOverrides = requireValue(argv, index, arg);
        break;
      case "--lesson-plan":
        index += 1;
        parsed.lessonPlan = requireValue(argv, index, arg);
        break;
      case "--max-items":
        index += 1;
        parsed.maxItems = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--pause-ms":
        index += 1;
        parsed.pauseMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--word-pause-ms":
        index += 1;
        parsed.wordPauseMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--review-intervals-ms":
        index += 1;
        parsed.reviewIntervalsMs = parseIntegerList(requireValue(argv, index, arg), arg);
        break;
      case "--review-offsets":
        index += 1;
        parsed.reviewOffsets = parseIntegerList(requireValue(argv, index, arg), arg);
        break;
      case "--render-audio":
        parsed.renderAudio = true;
        break;
      case "--no-normalize-audio":
        parsed.normalizeAudio = false;
        break;
      case "--target-lufs":
        index += 1;
        parsed.targetLufs = parseFiniteNumber(requireValue(argv, index, arg), arg);
        break;
      case "--true-peak-db":
        index += 1;
        parsed.truePeakDb = parseFiniteNumber(requireValue(argv, index, arg), arg);
        break;
      case "--loudness-range":
        index += 1;
        parsed.loudnessRange = parseFiniteNumber(requireValue(argv, index, arg), arg);
        break;
      case "--short-clip-threshold-ms":
        index += 1;
        parsed.shortClipThresholdMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--source-clip-padding-ms":
        index += 1;
        parsed.sourceClipPaddingMs = parseNonNegativeInt(requireValue(argv, index, arg), arg);
        break;
      case "--no-trim-tts-silence":
        parsed.trimTtsSilence = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

function parseIntegerList(value: string, flag: string): number[] {
  const values = value.split(",").map((entry) => entry.trim());
  if (values.length === 0 || values.some((entry) => entry.length === 0)) {
    throw new Error(`${flag} must be a comma-separated list of non-negative integers`);
  }
  return values.map((entry) => parseNonNegativeInt(entry, flag));
}

function parseFiniteNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number`);
  return parsed;
}

function readCueOverrides(path: string): Record<string, string> {
  return readOverrides(path, "--cue-overrides");
}

function readLessonPlan(path: string): LessonPlanOverride {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--lesson-plan must contain a JSON object");
  }
  return parsed as LessonPlanOverride;
}

function readOverrides(path: string, flag: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must contain a JSON object of source text to replacement text`);
  }
  const overrides: Record<string, string> = {};
  for (const [target, cue] of Object.entries(parsed)) {
    if (typeof cue !== "string" || !target.trim() || !cue.trim()) {
      throw new Error(`${flag} entries must have non-empty string keys and values`);
    }
    overrides[target] = cue;
  }
  return overrides;
}

function loadDotenv(): void {
  const envPath = resolve(import.meta.dir, "../.env");
  if (!existsSync(envPath)) return;
  const envText = readFileSync(envPath, "utf-8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}
