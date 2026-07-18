# Plan 003: Stop post-reply enrichment failures from clobbering a good agent message

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `plans/README.md` unless a
> reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/routes/api/messages.ts`
> If it changed, compare the "Current state" excerpts to the live code; on a
> mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent of 001/002, but 002's harness makes it testable)
- **Category**: bug
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

When the agent replies successfully, the reply text is written to the DB, and
then several **enrichment** steps run in the same `try` block and are `await`ed:
translation, Filo-doc build, and vocabulary tracking. If any of those throws
(translation provider down, a parse error, a transient API failure), control
jumps to the `catch`, which **overwrites the already-persisted good reply** with
`"Agent error: <message>"`. The user never sees what the agent actually said —
a correct reply is destroyed by a failure in an optional enrichment step. This
plan isolates enrichment so a failure there degrades gracefully (reply stays,
enrichment is skipped/logged) instead of masquerading as an agent failure.

## Current state

`src/routes/api/messages.ts`, inside `processAgentReply(...)`. The agent reply
is persisted first (good), then enrichment is awaited in the same try:

```ts
// src/routes/api/messages.ts:358-389  (inside the try)
await adminDb().update(
  "messages",
  {
    raw_text: completedAgentMessage.raw_text,
    healed_text: completedAgentMessage.healed_text,
    language: completedAgentMessage.language,
    translations: completedAgentMessage.translations,
  },
  [{ op: "eq", column: "message_id", value: agentMessage.message_id }],
);

await ensureTranslations([completedAgentMessage], agentLanguagePlan.requiredLanguages);
await enrichAndPersistMessageFiloDoc(adminDb(), completedAgentMessage);
await trackAgentVocabularyEncounters(
  adminDb(),
  userId,
  senderMember,
  conversationId,
  senderMember.target_languages.map((target) => ({
    message: completedAgentMessage,
    language: target.lang,
    cefrLevel: target.cefr_level,
  })),
);
ensureTransliterations(/* ... */).catch((err) => console.error(...));
ensurePhonetics(/* ... */).catch((err) => console.error(...));
```

The `catch` that clobbers the reply:

```ts
// src/routes/api/messages.ts:390-414
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("Agent communication failed:", err);
  const errorText = `Agent error: ${detail}`;
  const erroredAgentMessage: Message = { ...agentMessage, raw_text: errorText, /* ... */ };
  await adminDb().update("messages", { raw_text: errorText, /* ... */ }, [
    { op: "eq", column: "message_id", value: agentMessage.message_id },
  ]);
  await persistBaseMessageFiloDoc(adminDb(), erroredAgentMessage).catch(/* ... */);
}
```

Key insight: `ensureTransliterations` and `ensurePhonetics` are already
correctly fire-and-forget with `.catch(...)` (lines 382-389) — they do NOT take
down the reply. The problem is the three **awaited** calls
(`ensureTranslations`, `enrichAndPersistMessageFiloDoc`,
`trackAgentVocabularyEncounters`): a throw in any of them reaches the outer
`catch` and rewrites the message as an error.

**Convention in this file**: enrichment that must not break the mainline is
wrapped in a per-call `.catch((err) => console.error("...", err))` (see lines
382-389 here, and lines 218-223 in the user-message path). Match that pattern.

**The distinction to preserve**: a failure of the **agent call itself** (the
connector's `sendMessage`, which produces `completedAgentMessage`) SHOULD still
land in the catch and write `"Agent error: ..."` — that is correct behavior.
Only *enrichment* steps that run **after** the reply is persisted should be
isolated. Find the boundary: everything from the `await adminDb().update(...)`
that writes the real reply onwards is enrichment.

## Commands you will need

| Purpose     | Command                                              | Expected            |
|-------------|------------------------------------------------------|---------------------|
| Lint/format | `bun run check`                                      | exit 0              |
| Unit tests  | `bun test tests/services`                            | all pass            |
| Typecheck   | `bun run typecheck`                                  | 0 errors in file    |

## Scope

**In scope**:
- `src/routes/api/messages.ts` (the `processAgentReply` function only)
- `tests/services/agent-reply-enrichment.test.ts` (create — see Test plan)

**Out of scope**:
- The user-message enrichment block (lines ~206-259) — already fire-and-forget;
  do not restructure it in this plan.
- The agent connector layer (`src/services/agents/*`) — do not change how the
  reply is fetched.
- Adding a message "enrichment_status" column / schema change — explicitly
  deferred (see Maintenance notes). This plan is behavior-only, no migration.

## Git workflow

- Branch: `advisor/003-enrichment-failure-isolation`
- Commit style: imperative, e.g.
  `fix: don't overwrite a good agent reply when enrichment fails`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Isolate the three awaited enrichment calls

In `processAgentReply`, after the `await adminDb().update(...)` that persists
the real reply (line ~358-367), wrap **each** of the three post-reply enrichment
steps so a failure is logged but does not propagate to the outer catch. Two
acceptable shapes — pick one and apply consistently:

- Option A (match the file's existing style): convert each awaited call to
  fire-and-forget with `.catch`, e.g.
  ```ts
  ensureTranslations([completedAgentMessage], agentLanguagePlan.requiredLanguages)
    .catch((err) => console.error("Failed to translate agent response:", err));
  ```
  and likewise for `enrichAndPersistMessageFiloDoc(...)` and
  `trackAgentVocabularyEncounters(...)`.
- Option B (keep them sequential but non-fatal): wrap the block in an inner
  `try { await ...; await ...; await ...; } catch (err) { console.error("Agent reply enrichment failed:", err); }`
  placed **inside** the outer try, after the reply-persist update.

Prefer **Option B** if the three steps have an ordering dependency (Filo doc
built from translations); prefer Option A if they're independent. Inspect the
three functions' inputs: if `enrichAndPersistMessageFiloDoc` reads translations
that `ensureTranslations` mutates onto `completedAgentMessage`, they are ordered
→ use Option B. Otherwise Option A is fine.

The `ensureTransliterations`/`ensurePhonetics` fire-and-forget calls (lines
382-389) are already correct — leave them as-is.

**Verify**: `bun run check` → exit 0. `bun run typecheck` → no new errors in
`messages.ts`.

### Step 2: Confirm the outer catch now only fires on real agent failure

Read the resulting function. Confirm that reaching the outer `catch` (which
writes `"Agent error: ..."`) now requires a failure in the agent-call /
reply-construction path (before or at the reply-persist update), not in
enrichment. If the reply-persist `update` itself can still throw into the
catch, that is acceptable (a failed persist is a genuine failure). The goal:
translation/vocab/Filo failures no longer overwrite a persisted reply.

**Verify**: manual read + the test in Step 3.

### Step 3: Add a regression test

Create `tests/services/agent-reply-enrichment.test.ts`. Because
`processAgentReply` is not exported, test at the route level using the harness
pattern from plan 002 / `tests/services/audio-drill-routes.test.ts` (temp sqlite
dir, schema applied, real token). Use a **stub agent** connector so the reply is
deterministic: `config.testMode` + a connector of type `stub` (see
`src/services/agents/factory.ts:34` and `src/services/agents/stub.ts`). Set
`LANGOUSTE_TEST_MODE=true` and `LANGOUSTE_STUB_AI=true` in the test env so the
AI enrichment calls are stubbed.

The test asserts: after POSTing a user message that triggers an agent reply,
the persisted agent message's `raw_text` is the stub reply text and is **not**
prefixed with `"Agent error:"`. (You are proving the reply survives the
enrichment path.) If forcing an enrichment failure deterministically is
impractical with the stubs, at minimum assert the happy-path reply text is
intact and add a code-comment test note; a fault-injection test can be a
follow-up.

If wiring a full agent round-trip through the route proves too heavy for a unit
test, STOP and report — do not spend more than a reasonable effort here; the
Step 1 code change is the core deliverable and can be reviewed by reading.

**Verify**: `bun test tests/services/agent-reply-enrichment.test.ts` → passes.

### Step 4: Full suite + lint

**Verify**: `bun test tests/services` → all pass. `bun run check` → exit 0.

## Test plan

- New file `tests/services/agent-reply-enrichment.test.ts` (pattern: plan 002 /
  `audio-drill-routes.test.ts`), using a `stub` connector and stub AI.
- Case: a successful agent reply is persisted with its real text and no
  `"Agent error:"` prefix (proves enrichment no longer clobbers it).
- Optional/stretch: inject an enrichment failure and assert the reply text is
  still intact — only if achievable deterministically with the stubs.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits 0
- [ ] `bun test tests/services` exits 0, all pass, including the new test
- [ ] In `processAgentReply`, the three post-reply enrichment calls
      (`ensureTranslations`, `enrichAndPersistMessageFiloDoc`,
      `trackAgentVocabularyEncounters`) can no longer throw into the outer
      `catch` that writes `"Agent error:"` (verify by reading; the new test
      backs it)
- [ ] Only `src/routes/api/messages.ts` and the new test file are modified (`git status --porcelain`)
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report if:

- `processAgentReply` doesn't match the "Current state" excerpts (drifted).
- The three enrichment functions have a hidden ordering dependency that neither
  Option A nor B cleanly handles — report it and describe the dependency.
- A full route-level agent round-trip can't be driven from a test with the stub
  connector after a reasonable attempt (deliver Step 1 + a read-reviewed note).
- `bun test tests/services` shows a pre-existing failure unrelated to your
  change — report it, don't try to fix unrelated tests.

## Maintenance notes

- Deferred follow-up: add an `enrichment_status` field to `messages`
  (`pending` | `complete` | `failed`) so the client can show "translations
  still loading / unavailable" instead of silently missing data. That needs a
  migration in both `sqlite/schema.sql` and `supabase/migrations/` and a client
  change — a separate plan.
- Reviewer should confirm the outer `catch` still fires for genuine agent-call
  failures (connector timeout / error), i.e. the `"Agent error:"` path is not
  dead after this change.
