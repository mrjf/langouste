/**
 * Build a Pimsleur-style spaced-repetition tape from source audio.
 *
 * Usage:
 *   bun scripts/build-pimsleur-tape.ts \
 *     --url "https://example.com/unit01.mp3" \
 *     --lang hu \
 *     --out data/pimsleur/hu-unit-01a \
 *     --render-audio
 *
 * Outputs:
 *   transcript.json   normalized word-timestamp transcript
 *   source.filo.json  original source transcript + word/phrase/sentence tiers
 *   lesson.filo.json  generated lesson script + spaced-repetition/audio tiers
 *   *.pimsleur.mp3    final rendered audio, only with --render-audio
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotenv();

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.lang || !args.out) {
  console.error(
    "Usage: bun scripts/build-pimsleur-tape.ts --url <mp3-url> --lang <source-language> --out <dir> [--bridge en] [--title <title>] [--transcript <json>] [--max-items 48] [--render-audio]",
  );
  process.exit(1);
}

const { buildPimsleurTape } = await import("../src/services/pimsleur-tape/pipeline.ts");

const result = await buildPimsleurTape({
  sourceUrl: args.url,
  outputDir: args.out,
  sourceLanguage: args.lang,
  bridgeLanguage: args.bridge ?? "en",
  title: args.title,
  transcriptPath: args.transcript,
  renderAudio: args.renderAudio ?? false,
  maxItems: args.maxItems,
  pauseMs: args.pauseMs,
});

console.log("Wrote:");
console.log(`  transcript: ${result.transcriptPath}`);
console.log(`  source Filo: ${result.sourceFiloPath}`);
console.log(`  lesson Filo: ${result.lessonFiloPath}`);
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
  renderAudio?: boolean;
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
      case "--max-items":
        index += 1;
        parsed.maxItems = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--pause-ms":
        index += 1;
        parsed.pauseMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--render-audio":
        parsed.renderAudio = true;
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
