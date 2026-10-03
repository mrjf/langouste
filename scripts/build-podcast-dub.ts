/**
 * Fetch a podcast episode via its RSS feed, strip ad/sponsor paragraphs, translate the
 * remaining content into a target language, and render one bilingual dub: per paragraph,
 * target-language narration then the original clip, then per sentence, target-language
 * narration then the original clip.
 *
 * Usage:
 *   bun scripts/build-podcast-dub.ts \
 *     --feed "https://example.com/feed.xml" \
 *     --lang hu \
 *     --out data/podcast-dubs/episode-01
 *
 * Outputs:
 *   transcript.json    normalized word-timestamp transcript of the episode
 *   source.filo.json   original transcript + word/phrase/sentence tiers
 *   dub.filo.json       generated bilingual segment sequence + audio tiers
 *   episode.mp3         the downloaded source episode audio
 *   *.audio-drill.mp3   final rendered dub audio, unless --no-render-audio
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotenv();

const args = parseArgs(process.argv.slice(2));
if (!args.feed || !args.lang || !args.out) {
  console.error(
    "Usage: bun scripts/build-podcast-dub.ts --feed <rss-url> --lang <target-language> --out <dir> " +
      "[--episode latest|<index>|<guid>] [--source-lang en] [--title <title>] " +
      "[--paragraph-pause-ms 1500] [--transition-pause-ms 600] [--no-render-audio]",
  );
  process.exit(1);
}

const { buildPodcastDub } = await import("../src/services/podcast-dub/pipeline.ts");

const result = await buildPodcastDub({
  feedUrl: args.feed,
  episodeSelector: args.episode ?? "latest",
  outputDir: args.out,
  sourceLanguage: args.sourceLang ?? "en",
  targetLanguage: args.lang,
  title: args.title,
  paragraphPauseMs: args.paragraphPauseMs,
  transitionPauseMs: args.transitionPauseMs,
  renderAudio: args.renderAudio ?? true,
});

console.log(`Dropped ${result.droppedAdParagraphs} ad paragraph(s).`);
console.log("Wrote:");
console.log(`  transcript: ${result.transcriptPath}`);
console.log(`  source Filo: ${result.sourceFiloPath}`);
console.log(`  dub Filo: ${result.dubFiloPath}`);
if (result.outputAudioPath) console.log(`  audio: ${result.outputAudioPath}`);

interface Args {
  feed?: string;
  episode?: string;
  lang?: string;
  sourceLang?: string;
  out?: string;
  title?: string;
  paragraphPauseMs?: number;
  transitionPauseMs?: number;
  renderAudio?: boolean;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--feed":
        index += 1;
        parsed.feed = requireValue(argv, index, arg);
        break;
      case "--episode":
        index += 1;
        parsed.episode = requireValue(argv, index, arg);
        break;
      case "--lang":
      case "--target-lang":
        index += 1;
        parsed.lang = requireValue(argv, index, arg);
        break;
      case "--source-lang":
        index += 1;
        parsed.sourceLang = requireValue(argv, index, arg);
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
      case "--paragraph-pause-ms":
        index += 1;
        parsed.paragraphPauseMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--transition-pause-ms":
        index += 1;
        parsed.transitionPauseMs = parsePositiveInt(requireValue(argv, index, arg), arg);
        break;
      case "--no-render-audio":
        parsed.renderAudio = false;
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
