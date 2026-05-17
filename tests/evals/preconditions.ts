/**
 * Shared eval preconditions. Imported for side effects at the top of every
 * eval file: `import "./preconditions.ts";`
 *
 * Both checks are HARD FAILURES at module load (not test.skip): a green-but-
 * skipped eval hides regressions. Throwing here errors the importing file
 * before any test is defined and exits the process non-zero, so the failure
 * is loud and a run can never be mistaken for a pass.
 */

const HAS_KEY = process.env.ANTHROPIC_API_KEY?.startsWith("sk-") ?? false;

// The AI services read config.stubAi at call time. If a run sets
// LANGOUSTE_STUB_AI=true (or LANGOUSTE_TEST_MODE=true without an explicit
// LANGOUSTE_STUB_AI=false), evals would hit the stub and "pass" testing
// nothing.
const STUBBED =
  process.env.LANGOUSTE_STUB_AI?.trim().toLowerCase() === "true" ||
  (process.env.LANGOUSTE_TEST_MODE === "true" &&
    process.env.LANGOUSTE_STUB_AI?.trim().toLowerCase() !== "false");

if (!HAS_KEY) {
  throw new Error(
    "\n\n🚨 EVALS CANNOT RUN: ANTHROPIC_API_KEY is not set (must start with 'sk-').\n" +
      "   Evals hit the real Claude API and exist to catch prompt/model\n" +
      "   regressions. A skipped eval looks green while testing nothing, so\n" +
      "   this is a hard failure by design.\n\n" +
      "   Fix: ANTHROPIC_API_KEY=sk-... npm run test:evals\n",
  );
}

if (STUBBED) {
  throw new Error(
    "\n\n🚨 EVALS CANNOT RUN: AI is stubbed (LANGOUSTE_STUB_AI / LANGOUSTE_TEST_MODE).\n" +
      "   Evals must hit the real API or they assert nothing.\n\n" +
      "   Fix: unset LANGOUSTE_STUB_AI and LANGOUSTE_TEST_MODE, or set\n" +
      "   LANGOUSTE_STUB_AI=false, before running evals.\n",
  );
}
