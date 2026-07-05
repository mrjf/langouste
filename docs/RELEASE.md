# Release Process

> **Status — this is the target process, not the current one.** As of today,
> Langouste is distributed as **source only**: clone the repo, `bun install`,
> and run it locally in SQLite mode (see the [README](../README.md) quick
> start). The Tauri desktop app, Docker Compose self-host, signed binaries, and
> automated release pipeline described below are **planned, not yet
> implemented** — see [ROADMAP.md](./ROADMAP.md) for what exists today versus
> what's ahead. This document is the blueprint we're building toward.

How Langouste ships. Two deployment tiers (local desktop and self-hosted), semver, atomic migrations, reversible rollouts. The goal: releasing on any given Friday at 5 p.m. is safe.

## Two tiers

### Tier 1 — Desktop app (Tauri)

The flagship user experience. Target audience: a solo learner who wants Langouste running next to their browser.

- Wraps the Vite-built frontend + Bun backend in a Tauri shell.
- Single binary per platform: `.dmg` (macOS, signed + notarised), `.msi` (Windows, code-signed), `.AppImage` (Linux).
- Bundled local Supabase (GoTrue + Postgres + Realtime via embedded tauri-plugin-sqlx or a per-user Docker subordinate).
- Auto-update via Tauri's built-in updater, signed with a project key.
- Settings UI for `ANTHROPIC_API_KEY`, translation provider, connector configs.

Deployment pipeline:

1. Tag `v1.2.3` on the `main` branch.
2. GitHub Actions matrix builds macOS arm64 + Intel, Windows x64, Linux x64.
3. Each platform runs `tauri build`, `bun test`, `bun run build`.
4. Signed binaries uploaded to GitHub Releases.
5. Auto-updater manifest (`updater.json`) published to the project site, signed.

### Tier 2 — Docker Compose (self-host)

For users who want a persistent Langouste on a home server or VPS; families / small groups sharing an instance.

- `docker-compose.yml` in the repo root brings up: Langouste app, Postgres, GoTrue, Realtime, Kong (optional for external hosting).
- Single-command install: `curl -fsSL https://langouste.dev/install.sh | sh` (or the documented manual path).
- `.env.example` holds every required variable; `install.sh` interactively generates `.env`.
- Reverse proxy is not included — users bring their own Caddy / nginx / Cloudflare Tunnel.
- Database backups: a sidecar container runs `pg_dump` to a volume on a schedule.

Deployment pipeline:

1. Same tag as Tier 1.
2. GitHub Actions build produces `ghcr.io/langouste/langouste:1.2.3` (multi-arch).
3. Composition is updated with the new tag; users `docker compose pull && docker compose up -d`.

## Versioning

Strict semver. In public-beta (0.x) the rules are relaxed; from 1.0 onward:

- **MAJOR** — breaking change to the HTTP API, the MCP tool surface, the CLI, or the migration policy.
- **MINOR** — new feature, backward-compatible. New migrations are additive.
- **PATCH** — bug fix. No schema changes.

Pre-1.0, we use 0.Y.Z where Y bumps on breaking changes. Expect 0.x to last for roughly the duration of Phases 0–3.

## Migrations

Critical. A botched migration corrupts the data we spent months accumulating.

Rules:

- **Every schema change is a new migration file.** Never edit an existing one.
- **Migrations are additive.** Prefer adding a nullable column + backfill + then enforcing the constraint in a later migration, over a single destructive ALTER.
- **No migration depends on the application being on a specific version.** The app tolerates schemas that are one release ahead (column exists but unused) and one release behind (column about to exist is handled as optional).
- **`bun run migrate` is idempotent.** Re-running is a no-op, enforced by the `_migrations` table.
- **Test every migration on a fresh DB AND an upgrade from the previous release.** The integration suite has both scenarios.

Migration naming: `NNN_short_description.sql`, monotonically increasing.

### Destructive migrations

Drops, renames, NOT-NULL constraints on existing columns — handle as a two-release dance:

1. Release N: add the new column / relax the old one. Deploy.
2. Backfill offline, verify.
3. Release N+1: remove the old column / tighten the constraint.

Never both in one release. Rollback from a single-step destructive migration is painful; a two-step gives you a clean way back.

### Rollback

Every release carries a `ROLLBACK.md` in the tag notes. Contents:

- Whether the release has destructive migrations (y/n). If y, rollback is **forward-only** — do another release to undo.
- Any state the app expects that the previous version doesn't (new env vars, new tables, new connectors).
- The specific downgrade command: `docker compose down && docker tag ghcr.io/langouste/langouste:1.2.2 ghcr.io/langouste/langouste:latest && docker compose up -d`.

We prefer roll-forward over roll-back. A bad release gets a hotfix in hours, not a revert.

## Feature flags

Every non-trivial feature ships behind a flag. Schema:

```
feature_flags
  user_id       uuid, null for global flag
  flag_key      text
  enabled       boolean
  rollout_pct   int     -- 0..100 for gradual rollout
  created_at    timestamptz
```

Example rollout of FSRS (from `docs/LEARNING-MODEL.md`):

1. Ship the code with `fsrs_enabled` defaulting to off.
2. Enable for staff users (10 people).
3. Enable for 5% of users at random. Compare retention vs SM-2 control.
4. Ramp to 25%, 50%, 100%.
5. Remove the flag and the SM-2 fallback in a later release.

Flags live for one release cycle after 100% rollout, then get deleted with the fallback code. Long-term flags rot.

## CI/CD pipeline

On every push to a branch:

- Lint (biome), typecheck (svelte-check + tsc), unit tests, contract tests, fast integration tests.
- Build for `linux-x64` only — just to prove the build works.

On PR to main:

- All of the above, plus full integration tests and `@fast` Playwright suite.
- Deploy preview to a staging environment (ephemeral Docker compose on a hosted runner).

On tag push (`v*` or `v0.*`):

- Full test ladder including `@full` Playwright.
- Multi-platform build for Tauri (macOS arm64/x64, Windows x64, Linux x64).
- Multi-arch Docker build (amd64, arm64).
- Signatures attached, artefacts uploaded to GitHub Releases and GHCR.
- Release notes generated from conventional-commit history.
- Auto-update manifest posted.

Nightly:

- Full eval harness run (`docs/TESTING.md` layer 5). Results posted as a commit comment on main.
- Reference link healthcheck (`docs/REFERENCES.md`).

## Release cadence

Target: patch releases as needed, minor releases every 2–4 weeks, major releases when earned.

Ship early, ship often. Bigger batches make worse releases. A 2-week-old release candidate is more dangerous than shipping what you have today.

## Public beta (Phase 4 exit)

The transition from "dogfood" to "public" is one release tagged `v0.9.0`. What has to be true:

- Phase 4 exit criterion met: a non-author can install in < 5 min.
- Eval harness has ≥ 90 days of history showing flat-or-improving per-dimension quality scores.
- Documentation complete: install guide, user guide, contribution guide, privacy policy (see `docs/MARKETING.md` on this last one).
- Issue templates live on GitHub.
- A public roadmap (cut down from `docs/ROADMAP.md` for external consumption).
- The product has at least five non-author users using it daily for 30 days.

v1.0 is whenever we're comfortable committing to the 1.x API surface for a year.

## Signing keys and supply chain

- Tauri updater key: stored in 1Password, access controlled, rotation policy on 12-month cycle.
- Docker images signed with cosign, keyless via OIDC in GHA.
- Release attestations published via `gh attestation` so downstream users can verify provenance.
- Supply chain: `bun.lockb` committed; Dependabot PRs enabled; dependency count review quarterly (keep it lean — see `docs/ARCHITECTURE.md`'s dep list).

Security releases: private fix, coordinated disclosure, GHSA advisory. Target turnaround on a high-severity issue: 48 h.

### Known residual advisories

`bun audit` reports advisories that are **not reachable** by Langouste's shipped
runtime, or that require a dedicated migration. They are tracked here so a raw
audit run doesn't read as unaddressed. Direct dependencies with reachable
advisories have been bumped (hono, svelte, vite within 5.x). Residuals:

- **vite `server.fs.deny` bypass / `.map` traversal** — dev-server only, Windows
  only. The fix is in vite 6.x, which also requires bumping
  `@sveltejs/vite-plugin-svelte` to v5; that coordinated major bump is deferred
  to its own change. Not present in the production build output.
- **hono (transitive `4.12.9`)** — pulled in by
  `@anthropic-ai/claude-agent-sdk › @modelcontextprotocol/sdk`, not the app's
  HTTP surface (the app's direct hono is bumped and clear). The app defines no
  CORS middleware and uses no hono SSR/JSX or `toSSG`, so those advisories are
  not reachable. Clears when the agent SDK ships a newer MCP SDK.
- **svelte (transitive, via `svelte-check`)** — a devDependency; the advisories
  are SSR XSS / DOM-clobbering, and Langouste is a client-rendered SPA (no SSR),
  so they are not reachable at runtime. The app's direct svelte is clear.
- **shell-quote (critical)** — via `concurrently`, a devDependency used only by
  `bun run dev`. Not in any shipped path.
- **protobufjs / grpc-js / qs** — via `@google-cloud/translate`, reachable only
  when `TRANSLATION_PROVIDER=google-tllm` (off by default; the default is Claude).

## Post-release monitoring

For hosted instances (if we ever offer them):

- Sentry for unhandled exceptions.
- PostHog for anonymous usage events (opt-out respected).
- A `/healthz` endpoint returning 200 if DB + Supabase + Anthropic are reachable.
- Anthropic cost watch: alert at 50/75/90% of monthly budget.

For self-hosted: a bundled `langouste status` CLI command reports local health, logs tail, and last error. Nothing phones home without explicit opt-in.

## Communication

Every release has:

- **Release notes** on GitHub — structured: New / Changed / Fixed / Security / Migration.
- **CHANGELOG.md** in the repo follows Keep a Changelog format.
- **Announcement** in the project Discord and blog for minor+ releases.
- **Breaking change alerts** via GitHub Releases `[BREAKING]` prefix in the release title; plus an inline warning at the top of release notes.

Notes that promise *why* a change was made and what the user should do about it — not a commit log dump.
