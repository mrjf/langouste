# Langouste

Language-learning chat with AI agents. The user writes in their target language to a configured agent (Claude, OpenClaw, or any HTTP endpoint); Langouste checks spelling, explains errors, translates both sides, tracks vocabulary/grammar, and schedules review with SM-2 spaced repetition. See VISION.md for the full product vision and docs/message-processing.md for the message pipeline spec.

## Stack

- **Runtime**: Bun
- **HTTP**: Hono
- **Database/Auth/Realtime**: Supabase (Postgres + RLS + Realtime)
- **AI**: Claude API via @anthropic-ai/sdk
- **Frontend**: Svelte 5 (runes) + Vite
- **Deploy**: Supabase managed

## Commands

- `npm run dev` — run Vite dev server + Hono backend (parallel)
- `npm run dev:client` — Vite dev server only (port 5173, proxies /api to :8000)
- `npm run dev:server` — Hono backend only (port 8000)
- `npm run build` — build frontend for production
- `bun test` — run tests (backend, uses bun test runner)
- `bun run migrate` — apply pending database migrations
- `bun run start` — run production server (serves Vite build from dist/client)
- Use `bun` for installing packages

## Project structure

- `src/client/` — Svelte frontend (components, stores, lib)
- `src/routes/` — Hono API routes
- `src/services/` — backend services (AI, agents, database, spaced repetition)
- `src/services/agents/` — agent connectors (Claude, OpenClaw, HTTP) implementing the `AgentConnection` interface
- `src/lib/` — backend config and Supabase clients
- `src/types/` — shared TypeScript types
- `supabase/` — migrations and config

## Rules

- TypeScript strict mode everywhere
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) — no legacy Svelte 4 syntax
- CSS scoped in Svelte components — no separate CSS files for components
- All AI calls go through src/services/ai/ — never call Anthropic SDK directly from routes
- Agent traffic goes through src/services/agents/ connectors — never call the WebSocket/HTTP agent directly from routes
- Every conversation has exactly one `agent_connector_id` — there is no person-to-person chat in this build
- Database access only through src/services/database/ modules
- Server env variables via src/lib/config.ts — never read process.env directly elsewhere
- Client env variables via Vite's import.meta.env (VITE_ prefix)
- Corrections stored as JSONB, not separate rows
- Three-service AI pipeline: deterministic spell-check (nspell), Opus for error explanations, Sonnet for post-send vocabulary extraction
- Messages are never rewritten — user fixes their own errors before sending
- Spell-check service in src/services/spellcheck/ — deterministic, no LLM
- SM-2 algorithm in src/services/spaced-repetition/sm2.ts must be a pure function
- Rely on Supabase Realtime for all live updates — no custom websocket code
