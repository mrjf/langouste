# Plan 004: Validate LLM tool_use output at the parse boundary

> **Executor instructions**: Follow step by step; run every verification and
> confirm the expected result before continuing. On any "STOP condition", stop
> and report. Update `plans/README.md` when done unless a reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/services/ai/error-explainer.ts src/services/ai/vocabulary-extractor.ts src/services/audio-drill-tape/sentence-extractor.ts`
> On any change, compare "Current state" to live code; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

Three AI services take the `input` of a Claude `tool_use` block and cast it
straight to a TypeScript type with `as`, trusting the shape without checking it:

```ts
const result = toolUse.input as VocabularyExtractionOutput;  // vocabulary-extractor.ts:121
const result = toolUse.input as { corrected_message: string; explanations: [...]; ... };  // error-explainer.ts:65
```

`as` is a compile-time assertion — at runtime `toolUse.input` is whatever the
API returned. If the model omits a required field or the tool schema and the
type drift apart, downstream code reads `undefined` and fails far from the
cause (e.g. `result.explanations[i].corrected` throws, or a `.map` over
`undefined`). The current `?? []` / `?? ""` fallbacks paper over *some* of this
but silently turn a genuine malformed response into an empty result — the
learner loses an explanation with no signal. This plan adds a small runtime
guard at each parse boundary so a malformed tool response fails loudly (or is
handled explicitly) instead of degrading silently.

## Current state

- `src/services/ai/vocabulary-extractor.ts:116-127`:
  ```ts
  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Sonnet did not return structured output for vocabulary extraction");
  }
  const result = toolUse.input as VocabularyExtractionOutput;
  return {
    new_vocabulary: result.new_vocabulary ?? [],
    grammar_gaps_detected: result.grammar_gaps_detected ?? [],
    next_challenge: result.next_challenge ?? "",
  };
  ```
  (Note: the `!toolUse` guard is already good — that pattern is the model to
  extend.)

- `src/services/ai/error-explainer.ts:60-102`: same shape — guards `!toolUse`,
  then `const result = toolUse.input as { corrected_message: string; explanations: [...]; additional_errors: [...] }` and `.map`s over `result.explanations ?? []`.

- `src/services/audio-drill-tape/sentence-extractor.ts:~119`: casts `toolUse.input`
  to a structured object (confirm the exact line and shape by reading).

**No validation library is installed** (`package.json` has no `zod`/`superstruct`).
Do **not** add a dependency (the repo keeps deps lean — see
`docs/ARCHITECTURE.md`'s dependency stance and CLAUDE.md). Use hand-written type
guards.

**Convention to match**: throw a descriptive `Error` for a malformed structured
response, mirroring the existing `throw new Error("... did not return structured output ...")`
guards already in these files. Callers already treat these services as
throwing (the message pipeline wraps them in try/catch — e.g.
`src/routes/api/messages.ts` `.catch(...)` around the enrichment calls).

## Commands you will need

| Purpose     | Command                                       | Expected         |
|-------------|-----------------------------------------------|------------------|
| Lint/format | `bun run check`                               | exit 0           |
| Unit tests  | `bun test tests/services`                     | all pass         |
| Typecheck   | `bun run typecheck`                            | 0 errors in files|

## Scope

**In scope**:
- `src/services/ai/vocabulary-extractor.ts`
- `src/services/ai/error-explainer.ts`
- `src/services/audio-drill-tape/sentence-extractor.ts`
- `tests/services/llm-output-validation.test.ts` (create)
- Optionally a tiny shared helper file `src/services/ai/tool-output.ts` (create)
  if you factor the guard out — otherwise inline per file.

**Out of scope**:
- Adding any npm dependency (no zod/superstruct).
- Changing the tool schemas (`*_TOOL` definitions) — validate the response, not
  the request.
- The prompt text or model selection.

## Git workflow

- Branch: `advisor/004-validate-llm-tool-output`
- Commit style: imperative, e.g. `fix: validate tool_use output shape before use`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write a minimal runtime guard

Decide inline vs shared. If shared, create `src/services/ai/tool-output.ts` with
small assert helpers, e.g.:
```ts
export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed tool output: "${field}" must be an array`);
  }
  return value;
}
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Malformed tool output: "${field}" must be a string`);
  }
  return value;
}
```
Keep it dependency-free and tiny. (Inlining equivalent checks per file is also
acceptable — pick the lower-noise option for this codebase.)

**Verify**: `bun run check` → exit 0.

### Step 2: Guard vocabulary-extractor

In `vocabulary-extractor.ts`, after obtaining `toolUse.input`, validate the
required top-level fields before the return. Treat `new_vocabulary` and
`grammar_gaps_detected` as required arrays and `next_challenge` as a string
(the existing `?? ""` implies it may be absent — decide: if the tool schema
marks it required, require it; if optional, keep the `?? ""` but still reject a
non-string when present). Replace the blind `as` with a checked shape. Preserve
the existing successful-path return values.

**Verify**: `bun run typecheck` → no new errors in this file.

### Step 3: Guard error-explainer

In `error-explainer.ts`, validate `corrected_message` is a string and
`explanations` / `additional_errors` are arrays before the `.map` calls. Keep
the `?? []` only as a defense for a *present-but-null* field if the schema
allows it; a wrong *type* (e.g. an object where an array is expected) must
throw.

**Verify**: `bun run typecheck` → no new errors in this file.

### Step 4: Guard sentence-extractor

Read `src/services/audio-drill-tape/sentence-extractor.ts` around line 119, find
the `as`-cast tool output, and apply the same guard for its required fields.

**Verify**: `bun run typecheck` → no new errors in this file.

### Step 5: Tests

Create `tests/services/llm-output-validation.test.ts`. These services call the
Anthropic client, so test the **guard**, not a live API call. Two viable
approaches — pick the one that fits how these modules are structured after your
change:
- If you extracted helpers into `tool-output.ts`, unit-test them directly:
  `requireArray(undefined, "x")` throws; `requireArray([], "x")` returns `[]`;
  `requireString(3, "x")` throws.
- If the guards are inline, export a small internal `validateVocabularyOutput`
  (or similar) pure function and test it with a valid object, a
  missing-array object (expect throw), and a wrong-type object (expect throw).

Model structure on `tests/services/vocabulary-normalizer.test.ts` (a pure-function
unit test already in the suite).

**Verify**: `bun test tests/services/llm-output-validation.test.ts` → passes.

### Step 6: Full suite + lint

**Verify**: `bun test tests/services` → all pass. `bun run check` → exit 0.

## Test plan

- New file `tests/services/llm-output-validation.test.ts`, modeled on
  `tests/services/vocabulary-normalizer.test.ts`.
- Cases: valid shape passes; missing required array → throws with a message
  naming the field; wrong-type field → throws. (At least 3 assertions.)

## Done criteria

- [ ] `bun run check` exits 0
- [ ] `bun run typecheck` → no new errors in the three edited files
- [ ] `grep -n "toolUse.input as" src/services/ai/vocabulary-extractor.ts src/services/ai/error-explainer.ts src/services/audio-drill-tape/sentence-extractor.ts` shows the blind casts are replaced by validated access (no bare `as <Type>` on unchecked `toolUse.input`)
- [ ] `bun test tests/services` exits 0, includes the new validation test
- [ ] No new dependency added (`git diff package.json` is empty)
- [ ] Only in-scope files modified (`git status --porcelain`)
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report if:

- Any of the three files doesn't match the "Current state" shape (drifted).
- A field you'd mark "required" is actually optional in the tool schema (check
  the corresponding `*_TOOL` definition) — validating it as required would
  break valid responses. Report the mismatch.
- A guard makes an existing test fail because that test fed a partial object —
  report it; the test may encode the old lax contract intentionally.

## Maintenance notes

- If a validation library is ever adopted repo-wide, these hand-written guards
  are the natural first migration targets — keep them in one place if you
  factored `tool-output.ts`.
- Reviewer should confirm the thrown errors are caught by callers (the message
  pipeline already wraps these in try/catch) so a malformed response degrades to
  a logged failure, not an unhandled rejection.
