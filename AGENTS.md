# Langouste

Language-learning chat with AI agents. The user writes in their target language to a configured agent (Claude, OpenClaw, or any HTTP endpoint); Langouste checks spelling, explains errors, translates both sides, tracks vocabulary/grammar, and schedules review with SM-2 spaced repetition. See VISION.md for the full product vision and docs/message-processing.md for the message pipeline spec.

## Stack

- **Runtime**: Bun
- **HTTP**: Hono
- **Storage/search**: turbopuffer, with table-scoped namespaces and a dedicated Filo corpus index. See `docs/MODES.md`.
- **AI**: Claude API via @anthropic-ai/sdk
- **Frontend**: Svelte 5 (runes) + Vite
- **Deploy**: Bun/Hono plus hosted or BYOC turbopuffer

## Commands

- `bun run dev` — run Vite dev server + Hono backend (parallel)
- `bun run dev:client` — Vite dev server only (port 5173, proxies /api to :8000)
- `bun run dev:server` — Hono backend only (port 8000)
- `bun run build` — build frontend for production
- `bun run test` — run backend tests with the in-memory storage contract
- `bun run migrate` — validate turbopuffer connectivity and list namespaces
- `bun run import:turbopuffer` — batch-import a legacy SQLite/Supabase dataset
- `bun run start` — run production server (serves Vite build from dist/client)
- Use `bun` for installing packages

## Project structure

- `src/client/` — Svelte frontend (components, stores, lib)
- `src/routes/` — Hono API routes
- `src/services/` — backend services (AI, agents, database, spaced repetition)
- `src/services/corpus/` — Filo corpus indexing and turbopuffer-backed audio assets/drills
- `src/services/agents/` — agent connectors (Claude, OpenClaw, HTTP) implementing the `AgentConnection` interface
- `src/lib/` — backend config and turbopuffer storage adapter
- `src/types/` — shared TypeScript types
- `scripts/import-turbopuffer.ts` — non-destructive legacy importer

## Rules

- TypeScript strict mode everywhere
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) — no legacy Svelte 4 syntax
- CSS scoped in Svelte components — no separate CSS files for components
- All AI calls go through src/services/ai/ — never call Anthropic SDK directly from routes
- Agent traffic goes through src/services/agents/ connectors — never call the WebSocket/HTTP agent directly from routes
- Every conversation has exactly one `agent_connector_id` — there is no person-to-person chat in this build
- Database access only through the `Database` interface from src/lib/db/. The turbopuffer API key is server-only.
- The 7 modules in src/services/database/ are the only place tables are named. Routes call those; they don't call the DB directly.
- Server env variables via src/lib/config.ts — never read process.env directly elsewhere
- Client env variables via Vite's import.meta.env (VITE_ prefix)
- Corrections and Filo tier documents stay embedded in logical JSON rows
- Three-service AI pipeline: deterministic spell-check (nspell), Opus for error explanations, Sonnet for post-send vocabulary extraction
- Messages are never rewritten — user fixes their own errors before sending
- Spell-check service in src/services/spellcheck/ — deterministic, no LLM
- Enforce user ownership and conversation membership in routes/services; turbopuffer does not provide application-user RLS
