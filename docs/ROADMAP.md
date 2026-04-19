# Langouste Production Roadmap

From "working demo on one developer's laptop" to "OSS language-learning platform people actually use every day." Scoped to the agent-chat (Claude Code + OpenClaw) build on the `oss-agent` branch. Phases are sequenced by dependency, not calendar time. Owner count assumes one full-time engineer plus occasional linguistic review.

Each phase has a hard exit criterion. Don't start the next phase until the previous one's exit is met, or you end up with six half-finished features.

## Where we are today

Shipped:
- Agent chat loop (user ↔ agent) with Claude Code, Claude API, OpenClaw, and HTTP connectors.
- Deterministic spell-check (nspell) → Opus error explanation pipeline.
- Sonnet-based vocabulary + grammar-gap extraction, SM-2 scheduling.
- Translation/transliteration/phonetics pipeline for message display.
- Supabase auth + realtime + RLS, Svelte 5 frontend, Hono backend.

Known broken or missing:
- Claude Code agent replies aren't streamed — the UI hangs for ~10–30 s per turn.
- No streaming, no typing indicator, no progress feedback during the SDK roundtrip.
- Session auth sometimes drops on backend restart (stale refresh token).
- No audio (TTS), no listening exercises, no review UI beyond an API endpoint.
- No reference links on corrections. User sees the error but can't deep-dive.
- No CEFR assessment. Level is self-declared and never updated.
- No usage/cost dashboard; ANTHROPIC_API_KEY spend is opaque.
- No Docker-compose, no desktop packaging, no release process.
- Tests cover SM-2 only. No route tests, no eval harness, no L1-interference fixtures.

## Phase 0 — Stabilize the current build (exit: usable for dogfooding)

Prerequisite for everything else. Everything in this phase is bug fix or missing-but-small.

1. Fix session persistence. `App.svelte` gates on `profile.value` but should gate on `session.value`. `api.ts` wipes localStorage on first refresh failure; only clear on `invalid_grant` / `refresh_token_not_found`.
2. Stream Claude Code replies. Pass `includePartialMessages: true`, buffer `content_block_delta` events, emit SSE to the browser. Target: first-token latency visible within 2 s.
3. Surface agent errors in the UI (in-flight — `agent_error` field is wired, needs styling pass and retry button).
4. Usage telemetry. After each `SDKResultSuccess`, record `total_cost_usd` + token usage per user, per conversation. New table `usage_events`. Per-user daily total exposed via `/api/profile`.
5. Dev docs. `README.md` with 60-second-setup. `.env.example` with every required key. `docs/DEVELOPING.md` for the contributor path.

**Exit:** a new contributor can clone, `bun install && bun run dev`, sign up, and hold a 10-turn French conversation with Claude Code without hitting a known bug.

## Phase 1 — The learning model becomes real (exit: measurable progress)

Per research in `docs/LEARNING-MODEL.md`. This is the core product.

1. Schema: add `review_log` (every review event, forever — enables FSRS migration later) and `reference_links` (deterministic link catalog — see `docs/REFERENCES.md`). Widen `grammar_gaps` with `l1`, `cefr_target`, and `concept_id`.
2. L1-biased error prompt. User profile stores `base_languages[0]` already; Opus prompt prepends an L1-interference-primer paragraph derived from Swan & Smith's *Learner English*. Start with 4 L1s (EN, ES, FR, DE); add a canonical list per target.
3. CEFR band estimator. Nightly job computes features (MLU, type-token ratio, subordination ratio, error rate, lexical rarity) from the user's last 100 messages per target language. Emits a band (`A2–B1`) plus confidence. Writes `assessments` row. UI shows the band in the profile, not a point.
4. Reference links on corrections. For each `Correction`, attach up to three links (Wiktionary conjugation anchor, a concept-page link from the per-language curated map in `docs/REFERENCES.md`, a Tatoeba example-sentence URL). Render as "Learn more" chips under the explanation.
5. Scaffolded reveal. Error-explanation flow: first attempt shows only the squiggle + concept hint. After a second failed self-correction on the same span, show the fix inline.
6. Review UI. Proper interleaved daily-review screen with vocabulary and grammar-gap items mixed (not segmented). One-tap quality rating (0–5), playback of IPA, reveal of context sentence.
7. Comprehensible-input gate on Claude Code replies. Before each agent turn, pass the user's known-word set to the subagent via a system-prompt section; instruct Claude to cap unknown content-word rate at 5%. (Concrete: store a `known_lemmas` materialised view per user; pass a compressed summary.)

**Exit:** a user's CEFR band moves by a full sublevel (e.g. `A2` → `A2–B1`) over two weeks of daily use, and the change is supported by the feature evidence.

## Phase 2 — Audio & listening (exit: parity with voice-first competitors)

Text-only puts us behind Speak/Talkpal/Univerbal. Audio is also pedagogy: listening comprehension and pronunciation feedback are hard to do any other way.

1. TTS per message. Provider abstraction with ElevenLabs, OpenAI, Google Cloud TTS, and a local fallback (piper or mac `say` on desktop). Audio URLs persisted on the `messages` row.
2. Listening exercises. Pre-class drill surface: user hears an audio clip of a past agent message, types what they heard. Scored on edit distance against the canonical text.
3. Pronunciation coach subagent. Defined via `AgentDefinition`. User records themselves; STT transcribes; coach subagent compares to canonical text, flags mismatches by phoneme. Uses the Claude Agent SDK subagent mechanism — fresh context, no host-conversation leakage.
4. Forvo / Wiktionary audio embedding. For individual vocabulary items in review, deeplink to Forvo or use Wiktionary's Ogg assets.

**Exit:** a user can complete a full learning loop (chat, review, listen, speak) in one session without leaving Langouste.

## Phase 3 — Agent sophistication (exit: genuinely novel product)

Where Claude Code goes from "chat partner" to "tutor that can actually do things."

1. Langouste-as-MCP-server. Expose `lookup_vocab_item`, `record_correction`, `due_reviews`, `learner_profile` as tools. Any MCP host can drive Langouste; conversely Claude Code, running our session, can query learner state mid-conversation without us pre-packing it into the system prompt. This is the bigger architectural bet.
2. Role-play scenarios. Pre-built conversation contexts ("order coffee in Paris", "job interview in Berlin"). Stored as templates with L1/L2, goal, success criteria. Feeds into the agent's system prompt on session start.
3. Conversation replay. Saved session transcripts, re-playable as listening exercises later.
4. Targeted practice sessions. Given `grammar_gaps` for a user, spawn a focused 10-turn Claude Code session that uses only that grammar structure.
5. Cost caps. Per-user monthly USD ceiling. The SDK does not enforce this — we do, by rejecting new turns when the ceiling is hit.

**Exit:** Langouste can be described in one sentence to a language teacher and have them say "I'd use that with my students."

## Phase 4 — Ship it (exit: real users not on this laptop)

Everything in phases 0–3 assumes the developer's machine. This phase makes the thing installable.

1. Docker Compose bundle: Langouste + Postgres + GoTrue + Realtime. A single `docker compose up` brings the app up on a fresh host.
2. Tauri desktop app. Wraps the Vite build + Bun backend. Signed for macOS, Windows, Linux AppImage. This is the "my grandma can install it" tier.
3. Sandboxed tool use. When Claude Code has tools enabled (Bash, Read, Edit), execute them inside a Docker scratch container mounted at `/workspace`. Network off by default. "Trusted mode" toggle for users who want host access.
4. Observability. Structured JSON logs, OpenTelemetry traces around each turn, a simple admin dashboard showing turns/day, cost/day, error rate.
5. Release process. Semver, changelog, GitHub Actions matrix build (Linux/macOS/Windows), automated migration check against a fresh DB.
6. Public beta. OSS on GitHub, an issue template, a Discord, and — critically — a way for users to opt-in to upload redacted session telemetry for evaluation (see `docs/TESTING.md` on the eval harness).

**Exit:** someone who didn't write the code can install it and reach first-useful-turn within five minutes on a clean machine.

## Non-goals for v1

Listed so we don't drift. Each has a defensible reason.

- **Mobile native apps.** PWA + Tauri covers most of the audience. Native iOS/Android is a six-month sidequest.
- **Self-hosted model inference (Ollama, llama.cpp).** Claude is the product. Swappable models is a distraction until after v1.
- **Teacher/classroom mode.** Interesting adjacency but requires a whole RBAC layer. Post-v1.
- **Group chats with multiple human learners.** Already ripped out; don't re-add.
- **Formal CEFR placement test.** The band estimator is honest about uncertainty; a formal test has its own failure modes and buys less than you'd think.
- **Gamified streaks.** Duolingo's worst idea. Intentionally absent.

## Risk register

- **Claude API cost explosion.** Each message is a Sonnet vocab-extraction + possibly an Opus error explanation + a Claude Code turn. Back-of-envelope: $0.05–0.20 per chat turn at current pricing. Mitigation: cost cap + cache the deterministic parts + switch vocab extraction to Haiku once the schema is stable.
- **Supabase lock-in.** RLS and Realtime are deeply woven in. Mitigation: keep database access behind `src/services/database/` so a migration to Postgres-direct is mechanical.
- **Claude Code SDK API churn.** It's new. Mitigation: connector isolation in `src/services/agents/claude-code.ts` — the rest of the app doesn't know Claude Code exists.
- **Reference link rot.** URL patterns for Lingolia / Kwiziq may change. Mitigation: link registry stored in DB; a weekly job pings URLs and flags 404s.
- **Pedagogical claims outrunning evidence.** Don't market "CEFR-certified" or "proven to improve fluency" — we have no such evidence yet. Honest marketing in `docs/MARKETING.md`.
