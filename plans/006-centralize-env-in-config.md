# Plan 006: Route stray process.env reads through config.ts and document the vars

> **Executor instructions**: Follow step by step; verify each step; STOP and
> report on any STOP condition. Update `plans/README.md` when done unless a
> reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/lib/config.ts src/services/spellcheck/checker.ts src/services/spellcheck/languagetool-provider.ts src/services/agents/openclaw.ts .env.example`
> On any change, compare "Current state" to live code; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

CLAUDE.md states a hard rule: **"Server env variables via src/lib/config.ts —
never read process.env directly elsewhere."** Three service files break it, and
as a result their env vars are undocumented in `.env.example`, so a contributor
can't discover them:

- `src/services/spellcheck/checker.ts:25` reads `SPELLCHECK_PROVIDER`
- `src/services/spellcheck/languagetool-provider.ts:4` reads `LANGUAGETOOL_URL`
- `src/services/agents/openclaw.ts:199` reads `LANGOUSTE_OPENCLAW_DEBUG`

Also, `LANGOUSTE_AGENT_LANGUAGE_STRATEGY` is read in `config.ts` but missing from
`.env.example`. Consolidating these into `config.ts` restores the single source
of truth and lets us document every knob. (`src/lib/data-dir.ts` also reads
`process.env` — but for `LANGOUSTE_DATA_DIR`/`APPDATA`/`XDG_DATA_HOME`, which are
path-resolution primitives used before config loads; that file is a deliberate
exception — see Scope.)

## Current state

- `src/lib/config.ts` is the central config object (`export const config = {...}`).
  It already parses/validates several vars (e.g. `agentLanguageStrategy` at
  lines 17-24, `databaseMode`, `audioProvider`). Add the three stray vars here
  following the same style: read from `process.env`, apply defaults, expose on
  `config`.
- `src/services/spellcheck/checker.ts:25`:
  ```ts
  const setting = process.env.SPELLCHECK_PROVIDER ?? "noop";
  ```
- `src/services/spellcheck/languagetool-provider.ts:4`:
  ```ts
  const LANGUAGETOOL_URL = process.env.LANGUAGETOOL_URL ?? "https://api.languagetool.org/v2";
  ```
- `src/services/agents/openclaw.ts:199`:
  ```ts
  if (process.env.LANGOUSTE_OPENCLAW_DEBUG === "1") {
  ```
- `.env.example` already documents `SPELLCHECK_PROVIDER` (line 71) and
  `LANGUAGETOOL_URL` (line 72) as comments, but **not**
  `LANGOUSTE_AGENT_LANGUAGE_STRATEGY` or `LANGOUSTE_OPENCLAW_DEBUG`.

**Convention to match**: config keys are camelCase on the `config` object,
defaults inlined, invalid enum values throw at load (see the
`agentLanguageStrategy` block, `config.ts:17-24`). Consumers import
`{ config }` from the correct relative path to `src/lib/config.ts`.

## Commands you will need

| Purpose     | Command                                                    | Expected     |
|-------------|------------------------------------------------------------|--------------|
| Lint/format | `bun run check`                                            | exit 0       |
| Unit tests  | `bun test tests/services`                                  | all pass     |
| Typecheck   | `bun run typecheck`                                        | 0 new errors |
| Grep guard  | `grep -rn "process.env" src --include=*.ts \| grep -v "lib/config.ts" \| grep -v "lib/data-dir.ts"` | only allowed sites remain |

## Scope

**In scope**:
- `src/lib/config.ts` (add the three keys)
- `src/services/spellcheck/checker.ts`
- `src/services/spellcheck/languagetool-provider.ts`
- `src/services/agents/openclaw.ts`
- `.env.example` (document the two missing vars)

**Out of scope**:
- `src/lib/data-dir.ts` — its `process.env` reads (`LANGOUSTE_DATA_DIR`,
  `APPDATA`, `XDG_DATA_HOME`) are path primitives resolved before/around config
  load; leave them. If you want, add a one-line comment there noting the
  exception, nothing more.
- Client-side `import.meta.env` reads (those are the correct Vite pattern).
- Behavior changes — same defaults, same values; this is a refactor only.

## Git workflow

- Branch: `advisor/006-centralize-env-in-config`
- Commit style: imperative, e.g.
  `refactor: read SPELLCHECK_PROVIDER/LANGUAGETOOL_URL/OPENCLAW_DEBUG via config`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the three keys to config.ts

In `src/lib/config.ts`, add to the `config` object:
```ts
spellcheckProvider: (process.env.SPELLCHECK_PROVIDER ?? "noop").toLowerCase(),
languagetoolUrl: process.env.LANGUAGETOOL_URL ?? "https://api.languagetool.org/v2",
openclawDebug: process.env.LANGOUSTE_OPENCLAW_DEBUG === "1",
```
(Keep names/defaults identical to the current inline reads. If `checker.ts` uses
the raw case of `SPELLCHECK_PROVIDER`, match its existing comparison — inspect
whether it lowercases; if it doesn't, don't add `.toLowerCase()` here, to
preserve behavior exactly.)

**Verify**: `bun run typecheck` → no new errors.

### Step 2: Switch the three consumers to config

- `checker.ts:25` → `const setting = config.spellcheckProvider;` (add
  `import { config } from "../../lib/config.ts";` if not already imported —
  check the relative depth: `src/services/spellcheck/` → `../../lib/config.ts`).
- `languagetool-provider.ts:4` → `const LANGUAGETOOL_URL = config.languagetoolUrl;`
  with the matching import.
- `openclaw.ts:199` → `if (config.openclawDebug) {` — confirm `config` is
  imported in that file (it may already be); add the import if missing
  (`src/services/agents/` → `../../lib/config.ts`).

**Verify**: `bun run check` → exit 0; `bun run typecheck` → no new errors.

### Step 3: Confirm no stray reads remain

**Verify**:
`grep -rn "process.env" src --include=*.ts | grep -v "src/lib/config.ts" | grep -v "src/lib/data-dir.ts"`
→ returns nothing (or only sites you have justified and documented as
exceptions; there should be none beyond data-dir after this change).

### Step 4: Document the two missing vars in .env.example

Add commented entries near the relevant sections of `.env.example`:
- `# LANGOUSTE_AGENT_LANGUAGE_STRATEGY=target-first  # or english-mediated`
  (near the AI/agent config area).
- `# LANGOUSTE_OPENCLAW_DEBUG=1  # verbose OpenClaw frame logging (dev only)`
  (near any connector/debug notes; if none, add a short "Debug" comment block).

Do not add real values; comments/placeholders only.

**Verify**: `grep -c "LANGOUSTE_AGENT_LANGUAGE_STRATEGY" .env.example` → 1;
`grep -c "LANGOUSTE_OPENCLAW_DEBUG" .env.example` → 1.

### Step 5: Full suite + lint

**Verify**: `bun test tests/services` → all pass; `bun run check` → exit 0.

## Test plan

No new behavior, so no new test is required. If a test currently sets
`SPELLCHECK_PROVIDER`/`LANGUAGETOOL_URL` via `process.env` and relies on the
inline read, confirm it still works — because `config.ts` reads `process.env` at
module load, a test that sets the env before importing the consumer still gets
the value. If any existing test breaks due to import-time evaluation ordering,
that is a STOP condition (report it; the fix is to set env before first import,
matching the pattern in `tests/services/audio-drill-routes.test.ts`).

## Done criteria

- [ ] `bun run check` exits 0
- [ ] `bun run typecheck` → no new errors
- [ ] `grep -rn "process.env" src --include=*.ts | grep -v "src/lib/config.ts" | grep -v "src/lib/data-dir.ts"` returns nothing
- [ ] `.env.example` documents `LANGOUSTE_AGENT_LANGUAGE_STRATEGY` and `LANGOUSTE_OPENCLAW_DEBUG`
- [ ] `bun test tests/services` exits 0
- [ ] Only in-scope files modified (`git status --porcelain`)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report if:

- Any consumer file doesn't match the "Current state" excerpt (drifted).
- Moving a read into `config.ts` changes behavior because the consumer compared
  the raw (non-lowercased) value — preserve exact semantics; report the
  discrepancy if it forces a choice.
- An existing test breaks due to config's import-time env evaluation — report
  it.

## Maintenance notes

- New server env vars must be added to `config.ts` and `.env.example` in the
  same change — a reviewer should reject a new `process.env.X` outside
  `config.ts`/`data-dir.ts`.
- Consider a tiny unit test that imports `config` with a known env and asserts
  the three new keys — optional, not required by this plan.
