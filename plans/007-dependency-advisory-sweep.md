# Plan 007: Remediate reachable dependency advisories before public release

> **Executor instructions**: Follow step by step; verify each step; STOP and
> report on any STOP condition. Update `plans/README.md` when done unless a
> reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- package.json bun.lockb`
> If either changed, re-run `bun audit` and reconcile against this plan's
> "Current state" before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (dependency bumps can regress; gated by the test + build suite)
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

`bun audit` at this commit reports several advisories. Before a public release
they should be triaged and the reachable ones closed. **Most of the noisy Hono
advisories are NOT reachable** (they come from a *transitive* Hono pulled in by
`@anthropic-ai/claude-agent-sdk` → `@modelcontextprotocol/sdk`, and concern JSX
SSR / Lambda / `serve-static` / CORS-default paths the app never uses — the app
defines **no** CORS middleware and serves static assets via Hono's
`serveStatic`, not `toSSG`). This plan bumps the **direct** dependencies with
real advisories and the SDKs that carry high-severity transitive ones, then
re-audits — rather than chasing every transitive item.

## Current state

Verified `bun audit` output at commit `0785e48` (abridged, real):

- **`vite` <=6.4.2 (direct dependency)** — `high`: `server.fs.deny` bypass on
  Windows (GHSA-fx2h-pf6j-xcff); `moderate`: `.map` path traversal
  (GHSA-4w7w-66w2-5vf9). Dev-server only. `package.json` pins `vite: ^5.4.0`.
- **`svelte` >=5.46.0 <=5.55.6 (direct dependency)** — several `moderate` SSR
  XSS / DOM-clobbering / ReDoS advisories. `package.json` pins `svelte: ^5.55.1`.
  Note: this app is a **client-rendered SPA** (`vite build`, no SSR) — the SSR
  advisories are largely not reachable, but a patch bump within 5.x is low-risk.
- **`form-data` >=4.0.0 <4.0.6** — `high` CRLF injection; transitive via
  `@anthropic-ai/sdk` → `@types/node-fetch` → `form-data`. Closed by bumping the
  Anthropic SDK (or letting the lockfile resolve a patched `form-data`).
- **`shell-quote` <=1.8.3** — `critical` newline-escaping bug; transitive via
  `concurrently` (a **devDependency**, used only by `bun run dev`). Not in any
  shipped path.
- **`hono` <4.12.18** — many advisories, but on the **transitive** copy under
  `@anthropic-ai/claude-agent-sdk › @modelcontextprotocol/sdk › hono`, not the
  app's direct Hono. The reachable ones (CORS-default-wildcard) require CORS
  middleware the app does not use. Close by bumping the agent SDK if a newer
  version pulls a patched MCP SDK / Hono; otherwise document as
  not-reachable.
- **`qs`, `@protobufjs/utf8`, `@grpc/grpc-js`** — transitive via
  `@google-cloud/translate` (only used when `TRANSLATION_PROVIDER=google-tllm`,
  off by default). Bump `@google-cloud/translate` if a newer release clears
  them; else document.

**Repo constraints**: `bun.lockb` is committed; CI uses
`bun install --frozen-lockfile`. Bumps must update the lockfile. Keep changes
minimal and within semver-compatible ranges unless a fix requires a higher
floor.

## Commands you will need

| Purpose      | Command                                   | Expected                    |
|--------------|-------------------------------------------|-----------------------------|
| Audit        | `bun audit`                               | baseline, then fewer items  |
| Update deps  | `bun update <pkg>` / edit `package.json` + `bun install` | lockfile updates |
| Unit tests   | `bun test tests/services`                 | all pass                    |
| Build        | `bun run build`                           | exit 0                      |
| Lint/format  | `bun run check`                           | exit 0                      |
| Typecheck    | `bun run typecheck`                        | no new errors               |

## Scope

**In scope**:
- `package.json`, `bun.lockb`
- `docs/` — a short "known non-reachable advisories" note (optional; e.g. append
  to `docs/RELEASE.md`'s supply-chain section or a `SECURITY.md` note)

**Out of scope**:
- Replacing any dependency wholesale (that's plan territory of its own — e.g.
  the abandoned NLP deps are a separate finding).
- Changing app code to work around an advisory unless a bump forces a small
  compatible change (if it forces a large change, STOP).
- Bumping `vite`/`svelte` across a **major** version (5.x→6.x, etc.) — stay
  within the current major unless the audit floor demands otherwise; a major
  bump is a separate plan.

## Git workflow

- Branch: `advisor/007-dependency-advisory-sweep`
- Commit style: imperative, e.g. `chore(deps): bump vite/svelte and SDKs to clear advisories`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Capture the baseline

Run `bun audit` and save the list of advisories (copy into your report). This is
the before-state you'll compare against.

**Verify**: command runs; you have a recorded baseline.

### Step 2: Bump direct dependencies within their major

- `vite`: bump to the latest **5.x** patch that clears the two advisories
  (check `bun info vite versions` / the advisory "patched in" note; if the fix
  is only in 6.x, do NOT jump majors here — record it as deferred).
- `svelte`: bump to the latest **5.x** patch above 5.55.6 if one exists.

Edit `package.json` ranges accordingly, run `bun install`, and confirm the
lockfile updated.

**Verify**: `bun run build` → exit 0; `bun test tests/services` → all pass;
`bun run check` → exit 0.

### Step 3: Bump the Anthropic SDKs to clear transitive highs

- `@anthropic-ai/sdk`: bump to the latest patch/minor within its major to pull a
  patched `form-data` (>=4.0.6). Confirm afterwards that `bun audit` no longer
  lists `form-data`.
- `@anthropic-ai/claude-agent-sdk`: bump within its major if a newer version
  pulls a patched `@modelcontextprotocol/sdk` (and thus a patched transitive
  Hono / `qs`). If the newest available still carries them, leave it and record
  as not-reachable (see Step 5).

**Verify**: `bun run build` → exit 0; `bun test tests/services` → all pass. The
agent connectors (`src/services/agents/claude.ts`, `claude-code.ts`) still
typecheck: `bun run typecheck` → no new errors.

### Step 4: Optionally bump @google-cloud/translate

Only if it's low-risk and clears `qs`/`grpc-js`/`protobufjs`. This dep is used
only when `TRANSLATION_PROVIDER=google-tllm` (off by default), so it's low
priority — bump within major if clean, otherwise skip and document.

**Verify**: `bun run build` → exit 0; tests pass.

### Step 5: Re-audit and document residuals

Run `bun audit` again. For every advisory that remains, classify it:
- **Dev-only** (`concurrently`/`shell-quote`): note it's not in any shipped path.
- **Not reachable** (transitive Hono via MCP SDK; `@google-cloud/translate`
  when Google provider is off): note why.
Add a short "Supply chain — known residual advisories" list to `docs/RELEASE.md`
(or SECURITY.md) so a reader isn't alarmed by raw `bun audit` output. Do not
claim an advisory is fixed if it isn't.

**Verify**: the documented residuals match the current `bun audit` output;
`grep -n "residual" docs/RELEASE.md` (or wherever you added it) → found.

### Step 6: Final gate

**Verify**: `bun run check` → 0; `bun test tests/services` → pass;
`bun run build` → 0; `bun run typecheck` → no new errors.

## Test plan

No new tests — this is a dependency change. The gate is the existing suite +
build + typecheck passing after each bump, and `bun audit` showing fewer
reachable advisories than baseline. Run the E2E stub suite if cheap
(`bun run test:e2e` with stub config) as extra confidence — optional.

## Done criteria

- [ ] `bun run check` exits 0
- [ ] `bun test tests/services` exits 0
- [ ] `bun run build` exits 0
- [ ] `bun run typecheck` → no new errors
- [ ] `bun audit` shows the `form-data` high advisory cleared (or documented why not)
- [ ] `vite` and `svelte` bumped to advisory-clear 5.x patches (or the block documented as deferred/major-only)
- [ ] Residual advisories documented in `docs/` with reachability rationale
- [ ] `bun.lockb` updated and committed alongside `package.json`
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report if:

- Clearing an advisory requires a **major** version bump of `vite`, `svelte`, or
  either Anthropic SDK (that needs its own migration plan — report which and the
  floor version required).
- A bump breaks the build, tests, or typecheck and the fix is non-trivial
  (more than a small compatible adjustment).
- `bun audit` output diverges substantially from this plan's "Current state"
  (the tree drifted) — re-triage and report before bumping blindly.

## Maintenance notes

- Turn on Dependabot (referenced in `docs/RELEASE.md`) so these are caught
  continuously rather than at release time.
- The abandoned NLP deps (`nspell`, `phonemize`, `@piper-plus/g2p`,
  `transliteration`) are a **separate** finding (staleness, not a CVE) — do not
  fold them in here.
- Reviewer should confirm the "not reachable" claims by checking the app really
  uses no CORS middleware and no Hono SSR/`toSSG` paths.
