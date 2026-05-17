/**
 * YAML-driven exact-output evals for the chat message pipeline.
 *
 * Every tests/evals/cases/<lang>.yml file is auto-discovered. Each case runs
 * the REAL path used in production:
 *
 *   text --> checkSpelling(text, lang) --> errors[]
 *        --> explainErrors({ text, errors, intent, ... })
 *        --> assert corrected_message === expected   (trimmed-exact)
 *
 * "Trimmed-exact" = compare after .trim() on both sides only. No case
 * folding, no punctuation stripping — leading/trailing whitespace is the
 * only tolerated difference.
 *
 * To add coverage, edit the YAML — no code changes. See cases/hu.yml for the
 * format. A missing ANTHROPIC_API_KEY (or stubbed AI) is a hard failure; see
 * preconditions.ts.
 */
import "./preconditions.ts"; // HARD-fails at load if no API key / AI stubbed.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSpelling } from "../../src/services/spellcheck/checker.ts";
import { explainErrors } from "../../src/services/ai/error-explainer.ts";
import type { CefrLevel, LanguageCode } from "../../src/types/index.ts";

interface CaseFile {
  language: LanguageCode;
  defaults?: {
    base_languages?: LanguageCode[];
    cefr_level?: CefrLevel;
  };
  cases: Array<{
    name?: string;
    text: string;
    intent?: string;
    corrected: string;
    // Per-case overrides of the file defaults.
    base_languages?: LanguageCode[];
    cefr_level?: CefrLevel;
  }>;
}

const CASES_DIR = join(import.meta.dir, "cases");

const yamlFiles = readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

if (yamlFiles.length === 0) {
  throw new Error(`No eval case files found in ${CASES_DIR} (expected <lang>.yml)`);
}

for (const file of yamlFiles) {
  const raw = readFileSync(join(CASES_DIR, file), "utf8");
  const parsed = Bun.YAML.parse(raw) as CaseFile;

  if (!parsed?.language || !Array.isArray(parsed.cases)) {
    throw new Error(`${file}: must define top-level 'language' and a 'cases' array`);
  }

  const baseLangsDefault = parsed.defaults?.base_languages ?? (["en"] as LanguageCode[]);
  const cefrDefault = parsed.defaults?.cefr_level ?? ("A1" as CefrLevel);

  describe(`exact-output evals: ${file} (${parsed.language})`, () => {
    parsed.cases.forEach((kase, i) => {
      if (typeof kase.text !== "string" || typeof kase.corrected !== "string") {
        throw new Error(`${file} case #${i}: 'text' and 'corrected' are required strings`);
      }

      const label = kase.name ?? `${kase.text.slice(0, 40)} -> ${kase.corrected.slice(0, 40)}`;

      test(label, async () => {
        // Same call the production /check route makes.
        const errors = await checkSpelling(kase.text, parsed.language);

        const result = await explainErrors({
          text: kase.text,
          errors,
          target_language: parsed.language,
          base_languages: kase.base_languages ?? baseLangsDefault,
          cefr_level: kase.cefr_level ?? cefrDefault,
          intent: kase.intent,
          conversation_context: [],
        });

        expect(result.corrected_message.trim()).toBe(kase.corrected.trim());
      }, 60_000);
    });
  });
}
