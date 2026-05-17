# Architecture

How Langouste is put together, where the seams are, and what the interesting bits (Claude Code integration, MCP surface, streaming, subagents) actually do. Pair this doc with `docs/message-processing.md` for the message pipeline and `docs/LEARNING-MODEL.md` for the pedagogy logic.

## High-level

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Svelte 5)                        │
│                                                                  │
│   ConversationList   ChatThread   MessageInput   Review   …     │
│            │              │             │           │            │
│            └──── Supabase Realtime ─────┘           │            │
│                                                     │            │
└──────────────────────────┬──────────────────────────┼────────────┘
                           │ /api                     │
                           │ SSE for streaming        │
                           ▼                          │
┌─────────────────────────────────────────────────────┼────────────┐
│                    Bun + Hono backend               │            │
│                                                     │            │
│  routes/api/…  middleware  SSE endpoint             │            │
│       │                                             │            │
│       ▼                                             │            │
│  services/ai/             ──────── Anthropic API    │            │
│    error-explainer (Opus)                           │            │
│    vocabulary-extractor (Sonnet)                    │            │
│    translator (Claude/Google)                       │            │
│    phonetician / transliterator                     │            │
│                                                     │            │
│  services/agents/         ──────── agent providers  │            │
│    claude.ts              ──────── Anthropic API    │            │
│    claude-code.ts         ──────── Claude Agent SDK │            │
│    openclaw.ts            ──────── ws://localhost   │            │
│    http.ts                ──────── any HTTP API     │            │
│                                                     │            │
│  services/spellcheck/     local nspell              │            │
│  services/spaced-rep/     pure SM-2 fn              │            │
│  services/database/       Supabase client           │            │
│                                                     │            │
│  mcp/                     expose tools to any host  │            │
│    server.ts              stdio or HTTP             │            │
│    tools/                 due_reviews, learner_profile, …        │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
      Storage (sqlite mode)              or   Supabase (supabase mode)
      ~/.../Langouste/langouste.db            Postgres + RLS + Realtime + Auth
```

The backend is stateless except for per-connector agent connections cached in memory (`services/agents/factory.ts`). Auth, persistence, and (optional) pub/sub are owned by whichever backend `DATABASE_MODE` selects.

The two modes are explained in [MODES.md](./MODES.md); this doc covers the shared architecture.

## Layer responsibilities

### Svelte 5 client

- Authoritative on UI state only. Never mutates domain data directly — always via `/api`.
- Uses runes (`$state`, `$derived`, `$effect`) consistently; no legacy Svelte 4 syntax.
- Per-conversation message cache in memory so conversation switching is instant.
- Subscribes to Supabase Realtime for incoming messages from the agent.

### Hono backend

- Thin route handlers delegating to service modules. No business logic in routes beyond auth/validation.
- Middleware: `requireAuth` (verifies Supabase JWT, injects `userId` and a scoped `SupabaseClient`).
- Streaming endpoint (Phase 0) uses Server-Sent Events. Hono has first-class `streamSSE` — we use it.

### `services/ai/`

Claude-SDK-backed services, one per concern. Never call the Anthropic SDK from a route.

- `client.ts` — the singleton `Anthropic` client.
- `error-explainer.ts` — Opus, L1-biased prompt, returns structured corrections.
- `vocabulary-extractor.ts` — Sonnet, tool-use schema, returns vocabulary + grammar gaps + next-challenge suggestion.
- `translator.ts` — provider-abstracted. Claude and Google TLLM backends.
- `phonetician.ts`, `transliterator.ts` — mostly deterministic, Gemini fallback for unusual scripts.

### `services/agents/`

Connector pattern behind the `AgentConnection` interface.

- `claude.ts` — direct Anthropic API, the simplest option.
- `claude-code.ts` — wraps `@anthropic-ai/claude-agent-sdk`. Holds session ID for resume.
- `openclaw.ts` — WebSocket to `ws://127.0.0.1:18789` (see OpenClaw section below).
- `http.ts` — generic POST to any configured endpoint.
- `factory.ts` — caches active connections per `connector_id` in a process-local `Map`. This is why the claude-code connector can retain session ID between requests.

### `services/spellcheck/`

Provider pattern, fully local.

- `nspell-provider.ts` — Hunspell dictionaries per language. Covers spelling.
- `languagetool-provider.ts` — LanguageTool standalone process (optional, heavier install). Covers grammar beyond spelling.
- `noop-provider.ts` — fallback when no provider is available for the language.
- `detector.ts` — cheap n-gram-based language detection on user input.

### `services/spaced-repetition/`

- `sm2.ts` — pure function, fully tested. The only SRS we ship today.
- `tracker.ts` — takes a vocab-extraction result and upserts vocabulary + grammar-gap rows.
- `fsrs.ts` — not yet. When we migrate (see `docs/LEARNING-MODEL.md`), this module replaces `sm2.ts` behind the same interface.

### `services/database/`

Every database interaction goes through here. Routes never touch `SupabaseClient` directly (beyond the middleware-injected one).

Why: if we move off Supabase later, the surface of work is a handful of files instead of the whole app.

### `mcp/` (Phase 3)

Langouste-as-MCP-server. Exposes our pedagogical state as tools any MCP host can call:

- `list_due_reviews(user_id, language, limit)` — returns items due in SRS.
- `lookup_vocab_item(user_id, language, lemma)` — is this in the user's vocabulary? What's the state?
- `record_correction(user_id, message_id, correction)` — attach a correction to a message.
- `learner_profile(user_id)` — returns CEFR band, base languages, learning languages, known-lemma count.
- `concept_info(language, concept_id)` — canonical info + reference URLs for a grammar concept.

Transport: stdio for local Claude Code, streamable HTTP for remote hosts. The spec (2025-11-25 version of MCP) is followed exactly.

The payoff: Claude Code running a Langouste session can query state mid-turn without us pre-packing it into the system prompt. The model asks "what concepts has this user been working on?" instead of getting told once at session start.

## Claude Code integration in detail

The SDK:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
```

Per-turn life cycle in `services/agents/claude-code.ts`:

1. First `sendMessage`: build `options` with `systemPrompt`, `disallowedTools` (all tools if chat-only), optional `cwd`, `includePartialMessages: true`.
2. Iterate `query({ prompt, options })` — async iterable of `SDKMessage`.
3. Capture `session_id` from `SDKResultSuccess` or `SDKSystemMessage.init`.
4. For streaming, emit `SDKPartialAssistantMessage` `content_block_delta` events over SSE to the browser.
5. Final text is either the concatenated deltas (streaming) or `ResultSuccess.result`.
6. Next `sendMessage`: add `resume: sessionId` to options. Full conversation history is on disk, the SDK handles it.

Session files live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The Bun process `cwd` is the app root by default; per-connector config can override.

Multi-user on one host: each conversation has one `agent_connector_id` → one `ClaudeCodeAgent` instance in the factory cache → one session ID on disk. Collision-proof. **Caveat**: the SDK doesn't isolate per-user file access — tools running in one user's session can read anything the app process can read. See "Sandboxing" below.

### Subagents (Phase 2+)

The SDK supports custom subagents via `AgentDefinition`. We'll define at least:

- `pronunciation-coach`: compares user speech to canonical transcript, explains phoneme-level mismatches. `tools: []`.
- `concept-explainer`: deeper dive on a grammar concept, only activated when the user clicks "explain more" on a reference link. `tools: ["WebSearch"]` within a narrow URL allowlist.
- `scenario-runner`: drives a role-play conversation against a fixed scenario template. `tools: []`.

Subagents get fresh context per invocation — the main conversation's state isn't leaked in. That's valuable for cost and privacy, but it means we must explicitly pass what the subagent needs in its `prompt` or via our MCP server.

### Hooks and permissions

The SDK has `PreToolUse`, `UserPromptSubmit`, `ElicitationResult`, etc. For v1 we only use `PreToolUse`:

```typescript
hooks: {
  PreToolUse: [{
    matcher: "*",
    hooks: [async (input) => ({
      hookSpecificOutput: {
        permissionDecision: userHasTrustedMode ? "allow" : "deny",
        permissionDecisionReason: "User has not enabled trusted mode",
      },
    })],
  }],
}
```

Phase 3 adds a `PreToolUse` hook that prompts the user via the UI (`permissionDecision: "ask"`) for runtime approval per tool.

### Structured output

Some turns want JSON, not prose. For example, the end-of-session "concepts covered" summary. SDK supports `outputFormat: { type: "json_schema", schema }` — returned as `structured_output` on `ResultSuccess`. Incompatible with streaming, so these are separate non-streamed turns.

## Streaming pipeline

Browser → `POST /api/messages/:conversationId` returns SSE when the body contains `{ stream: true }`.

Events:

- `user_message` — the echo of what was persisted for the user's own message.
- `agent_partial` — a `content_block_delta` from the Agent SDK, containing `{ text: string }` chunk.
- `agent_final` — the final assembled agent message row after persistence and post-processing starts.
- `error` — agent failure, with error text.
- `done` — stream closing.

Client accumulates `agent_partial` chunks into the displayed message row until `agent_final` arrives and replaces it. If the stream closes without `agent_final`, we treat it as an error and show the retry banner.

## OpenClaw connector

OpenClaw ([openclaw/openclaw](https://github.com/openclaw/openclaw)) is a real MIT-licensed personal AI assistant that fronts WhatsApp/Telegram/Slack/Signal/Discord and voice via a local WebSocket gateway. Our connector speaks that gateway's protocol exactly:

- Connect to `ws://127.0.0.1:18789` with a `{type: "connect", device: {name, role: "client", capabilities: []}}` handshake.
- Request: `{type: "req", id, method: "agent", params: {message}}`.
- Response: `{type: "res", id, ok, payload: {text | message | content}, error?}`.

The gateway enforces local-only binds (`gateway.mode=local` in `~/.openclaw/openclaw.json`); non-loopback is refused. This is good — Langouste sits alongside WhatsApp as "another channel" into whatever OpenClaw's user has configured.

Phase 3 MCP work may or may not deprecate this connector. Likely we keep it — OpenClaw users are already bought in to the local-gateway pattern.

## Sandboxing (Phase 4)

If Claude Code tools are enabled (Bash, Read, Edit, Write), the blast radius is "anything the Bun process can touch." This is fine in a desktop app the user owns; it's catastrophic in any multi-tenant hosting scenario.

Chosen pattern: **Docker sandbox profile**. When tools are enabled, the Claude Code session runs inside a short-lived container:

- `docker run --rm --network=none -v ${session_workdir}:/workspace ghcr.io/anthropics/claude-code-runtime:${version}`
- `session_workdir` is a scratch dir in `~/.langouste/sessions/<session-id>/`.
- Network off by default; a toggle grants `--network=default` for sessions that need `WebSearch`/`WebFetch`.
- Host FS outside `/workspace` is invisible.

For untrusted hosting (if we ever go there), upgrade to E2B or Firecracker-based isolation. Not v1.

## Observability

Structured JSON logs from day one — there's no retrofitting a log format. Fields: `ts, level, event, user_id, conversation_id, turn_id, cost_usd?, duration_ms?, error?`.

Per-turn trace spans (Phase 4) via OpenTelemetry — one root span per user message, child spans for spell-check, error-explain, vocab-extract, agent-turn, translation fan-out.

Admin dashboard (Phase 4): turns/day, cost/day, p50 and p95 turn latency, error rate by stage, connector mix.

## The process model

Single Bun process runs everything today. Fine up to a few hundred concurrent users on a reasonably sized box. When we hit scale issues:

- The Sonnet post-send pipeline (vocab extraction, translations, transliterations, phonetics) is fire-and-forget today. When it chokes, we convert to a BullMQ/pgmq-backed queue. `services/ai/` stays the same; the caller just enqueues instead of awaiting.
- The Claude Code session cache is per-process. Sticky sessions are needed if we ever run multiple app instances — either via a Redis-backed session map or by routing on `conversation_id` hash.

Don't do either until a profiler says we need to.

## Dependency list (target state)

Runtime:

- Bun ≥ 1.1
- Node-compatible: `hono`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `nspell`, `dictionary-*` per language, `@google-cloud/translate`, `@google/genai`.

Dev:

- `vite`, `svelte@5`, `@playwright/test`, `concurrently`.

Infra:

- Supabase (local via docker-compose, managed in prod).
- Docker (Phase 4 sandbox).

Removed from scope: ollama, langchain, any ORM. Keep the deps tight.
