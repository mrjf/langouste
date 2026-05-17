/**
 * Evals for the Opus error-explainer — these hit the REAL Claude API and
 * assert on output quality, not just shape. They are regression guards for
 * prompt changes in src/services/ai/error-prompts.ts.
 *
 * Unlike tests/services (stubbed, deterministic), evals are non-deterministic
 * and cost tokens. They are NOT part of `npm test`. Run explicitly:
 *
 *   ANTHROPIC_API_KEY=sk-... npm run test:evals
 *
 * A missing ANTHROPIC_API_KEY is a HARD FAILURE, not a skip. Evals exist to
 * catch model/prompt regressions; a silently-skipped eval is worse than no
 * eval because it looks green while testing nothing. We throw at module load
 * so the failure is immediate and impossible to miss — no test runs until the
 * key is present and the AI is unstubbed.
 *
 * Assertions check the *semantics* that regressed, never raw substrings of
 * the explanation prose: (1) the correct greeting survives, (2) the garbled
 * tail is fixed to some valid Hungarian, (3) no structured error span covers
 * the greeting word itself. We deliberately do NOT keyword-match explanation
 * text — a correct explanation legitimately reuses phrases ("doesn't belong",
 * "who am I") to contrast the literal reading against the intent, and earlier
 * revisions that banned those substrings produced false positives. Asserting
 * on error spans + the corrected message keeps the eval robust to model
 * wording and across model versions.
 */
import "./preconditions.ts"; // HARD-fails at load if no API key / AI stubbed.
import { describe, expect, test } from "bun:test";
import type { TextError } from "../../src/types/index.ts";

const itEval = test;

describe("error-explainer eval: intent is honored", () => {
  itEval(
    "stated intent prevents a correct greeting from being flagged (regression: 'jo reggelt ki vanok')",
    async () => {
      // Import lazily so the module reads config AFTER the stub guard above.
      const { explainErrors } = await import("../../src/services/ai/error-explainer.ts");

      // What the deterministic spell-checker would flag: the two real
      // misspellings. `jó reggelt` is correct Hungarian and is NOT flagged.
      const errors: TextError[] = [
        { start: 0, end: 2, text: "jo", kind: "spelling", suggestions: ["jó"] },
        { start: 13, end: 18, text: "vanok", kind: "spelling", suggestions: ["vagyok"] },
      ];

      const result = await explainErrors({
        text: "jo reggelt ki vanok",
        errors,
        target_language: "hu",
        base_languages: ["en"],
        cefr_level: "A1",
        intent: "I'm saying good morning",
        conversation_context: [],
      });

      const corrected = result.corrected_message.toLowerCase();

      // 1. The correct greeting survives, accent-fixed, in the corrected
      //    message. This is the core regression: `jó reggelt` is correct
      //    Hungarian and must not be "corrected" away.
      expect(corrected).toContain("jó reggelt");

      // 2. The garbled tail is fixed to *some* valid Hungarian. Given the
      //    stated intent ("I'm saying good morning"), there are two
      //    defensible readings of `ki vanok`:
      //      - "jó reggelt vagyok"  (literal: a learner reaching for "I am")
      //      - "jó reggelt kívánok" (idiomatic: "I wish [you] good morning")
      //    Either is acceptable; what's NOT is leaving `vanok` (a non-word)
      //    in place. We assert the fix happened without pinning the wording.
      expect(corrected).not.toContain("vanok");
      const fixedToValid = corrected.includes("vagyok") || corrected.includes("kívánok");
      expect(fixedToValid).toBe(true);

      // 3. The model must NOT flag the *greeting itself* as the error. The
      //    old buggy output framed `jó reggelt` as a correction ("'Good
      //    morning' ... is simply jó reggelt") as if the learner hadn't
      //    written it. No error span should cover the greeting: the only
      //    real errors are the accent on `jo` and the garbled `ki vanok`.
      //
      //    We assert on structured error SPANS, never on explanation prose.
      //    A correct explanation legitimately contrasts the literal reading
      //    ("ki vanok would parse as 'who am I'") against the intended
      //    meaning — banning such substrings flags correct teaching as a
      //    failure. Earlier revisions of this eval did exactly that and
      //    produced false positives; the lesson is encoded here on purpose.
      const greetingFlagged = [
        ...result.explanations.map((e) => e.error),
        ...result.additional_errors,
      ].some((e) => {
        const span = "jo reggelt ki vanok".slice(e.start, e.end).toLowerCase();
        return span.includes("reggelt");
      });
      expect(greetingFlagged).toBe(false);

      // 4. It still surfaces a correction for the garbled tail somewhere
      //    (as a spell-check explanation or an additional grammar error),
      //    rather than silently rewriting with no feedback.
      const explainedTail = (s: string) => s.includes("vagyok") || s.includes("kívánok");
      const flaggedTail =
        result.explanations.some((e) => explainedTail(e.corrected.toLowerCase())) ||
        result.additional_errors.some((e) => explainedTail(e.corrected.toLowerCase()));
      expect(flaggedTail).toBe(true);
    },
    60_000,
  );
});
