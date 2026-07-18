# Plan 008: Close OSS-release hygiene gaps (docs accuracy, vendored licensing, CoC)

> **Executor instructions**: Follow step by step; verify each step; STOP and
> report on any STOP condition. Update `plans/README.md` when done unless a
> reviewer owns the index. Several steps are documentation edits — still run the
> verification greps.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- CLAUDE.md AGENTS.md docs/RELEASE.md package.json`
> On any change, compare "Current state" below to live files; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

The repo is about to be published under MIT. A few gaps would mislead new
contributors or create licensing ambiguity:

1. `CLAUDE.md` and `AGENTS.md` tell agents/contributors to run `npm run …`, but
   the project is **bun-only** (README, package.json, CI all use bun). An agent
   executor following these files will use the wrong tool.
2. `docs/RELEASE.md` describes a Tauri desktop app and Docker Compose self-host
   as if they exist; `docs/ROADMAP.md` explicitly says they don't yet. A release
   reader is misled about current state.
3. The vendored packages `filo/` and `lit/` declare `"license": "MIT"` in their
   `package.json` but ship **no LICENSE file** — a provenance gap for
   downstream auditors. `lit/` is also imported by relative path
   (`../../../lit/src`) but is **not declared** as a dependency in the root
   `package.json` (unlike `filo`, which is `"filo": "file:./filo"`).
4. There is **no CODE_OF_CONDUCT.md** — standard for an OSS project inviting
   contributions.

(Note: SECURITY.md already has a reporting path and issue/PR templates already
exist — those are NOT gaps and are out of scope.)

## Current state

- `CLAUDE.md:16-19` and `AGENTS.md:16-19` use `npm run dev`, `npm run dev:client`,
  `npm run dev:server`, `npm run build`; other lines already use `bun run`.
  Example (`CLAUDE.md:16`): `- \`npm run dev\` — run Vite dev server + Hono backend (parallel)`.
  The user's saved preference and the repo convention is **bun** (see the
  bun-only commands in `package.json` and README).
- `docs/RELEASE.md:5-40` — "Tier 1 — Desktop app (Tauri)" and "Tier 2 — Docker
  Compose" written in the present tense; no Tauri config or `docker-compose.yml`
  exists in the repo. `docs/ROADMAP.md` (the "where we are today" section)
  contradicts it.
- `filo/package.json` → `"license": "MIT"`, no `filo/LICENSE` file.
  `lit/package.json` → `"license": "MIT"`, no `lit/LICENSE` file.
- Root `package.json` `dependencies` has `"filo": "file:./filo"` but no `lit`
  entry; `lit` is consumed via relative import in
  `src/services/corpus/ipa-layers.ts:8` and `src/services/ai/phonetician.ts:2`.
- Root `LICENSE` is MIT, `Copyright (c) 2026 Robson Harrington and contributors`.
- No `CODE_OF_CONDUCT.md` at repo root.

## Commands you will need

| Purpose     | Command                                  | Expected                         |
|-------------|------------------------------------------|----------------------------------|
| Lint/format | `bun run check`                          | exit 0                           |
| Build       | `bun run build`                          | exit 0 (only if you touch deps)  |
| Grep guards | see per-step verifications               | as stated                        |

## Scope

**In scope**:
- `CLAUDE.md`, `AGENTS.md` (npm → bun)
- `docs/RELEASE.md` (mark aspirational sections)
- `filo/LICENSE`, `lit/LICENSE` (create)
- `CODE_OF_CONDUCT.md` (create)
- Optionally `package.json` (declare `lit` as a `file:` dep for consistency) —
  see Step 4's caution.
- Optionally `README.md` / `CONTRIBUTING.md` (a one-line on-disk-secrets note) —
  Step 6.

**Out of scope**:
- SECURITY.md — already adequate.
- Issue/PR templates — already exist.
- `docs/MARKETING.md` visibility — that's a maintainer judgment call, flagged
  separately; do not delete or move it here.
- Rewriting RELEASE.md wholesale — only add a clear "current vs planned" marker.

## Git workflow

- Branch: `advisor/008-oss-release-hygiene`
- Commit style: imperative, e.g. `docs: fix bun commands and mark aspirational release tiers`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: npm → bun in CLAUDE.md and AGENTS.md

Replace `npm run` with `bun run` (and `npm test` with `bun test`) in both files.
Only the command tokens change; keep the descriptions.

**Verify**: `grep -c "npm run" CLAUDE.md AGENTS.md` → 0 for both;
`grep -c "bun run dev" CLAUDE.md` → ≥ 1.

### Step 2: Mark RELEASE.md aspirational sections

At the top of `docs/RELEASE.md`, add a short banner, e.g.:
> **Status note:** This document describes the *target* release process. As of
> the current release, distribution is source-only (`git clone` + `bun install`
> + `bun run dev`) in local SQLite mode. The Tauri desktop app and Docker
> Compose self-host described below are planned, not yet implemented — see
> `docs/ROADMAP.md` for current status.

Do not delete the aspirational content; just frame it.

**Verify**: `grep -n "target" docs/RELEASE.md` → the banner is present near the
top (before the "Tier 1" heading).

### Step 3: Add LICENSE files to filo/ and lit/

Copy the root MIT `LICENSE` text into `filo/LICENSE` and `lit/LICENSE`, keeping
the same copyright line as the root (`Copyright (c) 2026 Robson Harrington and
contributors`) unless the vendored package headers indicate different authorship
— if they do, STOP and ask (provenance must be correct, not guessed).

**Verify**: `test -f filo/LICENSE && test -f lit/LICENSE && echo OK` → `OK`;
`head -1 filo/LICENSE` → `MIT License`.

### Step 4: (Optional) declare `lit` as a dependency for consistency

`lit/` is imported by relative path today, which works but is inconsistent with
`filo` and hides the dependency from the manifest. If you make this change:
- Add `"@langouste/lit": "file:./lit"` (match `lit/package.json`'s `"name"` —
  read it; it is `@langouste/lit`) to root `package.json` `dependencies`.
- Do **not** rewrite the relative imports in this plan (that's a broader
  refactor) — declaring the dep is enough to record provenance.
- Run `bun install` and `bun run build`.

If declaring it causes any install/build friction (e.g. the `file:` package
isn't built to its `main`), **revert this step** and instead add a one-line note
to `CONTRIBUTING.md` documenting that `lit/` is a vendored first-party package
imported by path. Consistency is the goal, not breakage.

**Verify** (if done): `bun run build` → exit 0;
`grep -c "lit" package.json` → ≥ 1.

### Step 5: Add CODE_OF_CONDUCT.md

Create `CODE_OF_CONDUCT.md` using the Contributor Covenant (a standard,
widely-recognized text). Fill the contact method to match SECURITY.md's approach
(GitHub private reporting / repository owner) rather than inventing an email.

**Verify**: `test -f CODE_OF_CONDUCT.md && echo OK` → `OK`;
`grep -ci "contributor covenant" CODE_OF_CONDUCT.md` → ≥ 1.

### Step 6: (Optional) on-disk secrets safety note

The repo's `.env` and `.env.supabase` are correctly gitignored and were never
committed — no history rewrite is needed. As a light safeguard, add one line to
`CONTRIBUTING.md` (or README's setup section) reminding contributors never to
`git add -f` an env file and to rotate keys if one is ever shared. Keep it to a
sentence.

**Verify**: `grep -ni "env" CONTRIBUTING.md` shows the added note (if you added
it).

### Step 7: Lint

**Verify**: `bun run check` → exit 0. (Docs/markdown may not be linted by biome;
if `check` doesn't cover them, that's fine — just ensure it still passes for
`src/tests/scripts`.)

## Test plan

No code tests — this plan is docs/licensing. Verification is the greps above
plus `bun run check` (and `bun run build` if Step 4's dep change was made).

## Done criteria

- [ ] `grep -c "npm run" CLAUDE.md` → 0 and `grep -c "npm run" AGENTS.md` → 0
- [ ] `docs/RELEASE.md` has a top-of-file current-vs-planned status banner
- [ ] `filo/LICENSE` and `lit/LICENSE` exist, MIT, matching root copyright
- [ ] `CODE_OF_CONDUCT.md` exists (Contributor Covenant)
- [ ] If Step 4 was done: `bun run build` exits 0 and `package.json` references `lit`; if reverted, `CONTRIBUTING.md` documents the vendored `lit/`
- [ ] `bun run check` exits 0
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report if:

- `filo/` or `lit/` source headers indicate authorship other than the root
  copyright holder (provenance must be verified, not assumed).
- Declaring `lit` as a `file:` dep breaks install/build and reverting doesn't
  cleanly restore (should not happen — the relative imports are untouched).
- `docs/RELEASE.md`/`CLAUDE.md`/`AGENTS.md` don't match the "Current state"
  excerpts (drifted).

## Maintenance notes

- If the Tauri/Docker tiers get built, remove the RELEASE.md status banner.
- The `docs/MARKETING.md` public-visibility question is a separate maintainer
  decision — not resolved here.
- Reviewer should confirm the CoC contact path matches SECURITY.md and that the
  vendored LICENSE copyright is correct.
