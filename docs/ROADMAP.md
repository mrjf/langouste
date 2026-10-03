# Langouste Production Roadmap

From "working demo on one developer's laptop" to "OSS language-learning platform people actually use every day." Scoped to the agent-chat (Claude Code + OpenClaw) build on the `oss-agent` branch. Phases are sequenced by dependency, not calendar time. Owner count assumes one full-time engineer plus occasional linguistic review.

Each phase has a hard exit criterion. Don't start the next phase until the previous one's exit is met, or you end up with six half-finished features.

## Content strategy

Langouste should minimize AI-generated pedagogical content wherever practical. AI is best used for adaptation, explanation, annotation, retrieval, scheduling, and feedback — not as the primary author of the language the learner consumes.

Priority order for learner-facing target-language content:

1. **Natural content from native contexts.** Podcasts, YouTube captions, articles, course clips, films/TV subtitles where licensing permits, transcripts, public-domain texts, and other real usage.
2. **Native-speaker-authored learning content.** Dialogues, role-play scenarios, graded examples, pronunciation scripts, and cultural notes written or reviewed by native speakers and language teachers.
3. **AI-assisted adaptation of sourced content.** Simplification, glossing, annotation, cloze generation, level checks, and targeted review prompts derived from a real source.
4. **AI-generated content as a fallback.** Use only when no suitable natural or native-authored source exists, or when the product needs a highly specific controlled prompt for assessment/review.

The product moat should be "natural language made learnable," not "infinite synthetic worksheets."

## AI controls and feature flags

Langouste needs an explicit global AI toggle, not just provider configuration. When the global AI switch is off, every LLM/agent-dependent feature is disabled at both the UI and API layers: no agent chat, no Claude/OpenClaw/HTTP-agent turns, no LLM explanations, no AI-generated exercises or content, no AI pronunciation coach, no AI extraction jobs, and no AI-assisted adaptation. In this mode the product should operate as a human-generated-resource learner: sourced courses, texts, audio, dictionaries, Wiktionary/Tatoeba/Wikisource/LibriVox-style references, deterministic spell-check, rule-based or statistical NLP, and conventional machine translation/transliteration tools only.

This should be a first-class product mode, not a degraded failure state. The UI should hide unavailable AI surfaces, explain why they are unavailable, and route learners toward human-generated resources and traditional NLP/MT workflows. Backend enforcement matters: feature handlers should reject disabled AI paths even if a stale client calls them.

Every feature should also have an individual feature flag. Flags should be documented in one registry with owner, default, rollout scope, dependencies, and whether the feature is AI-dependent. The same registry should drive environment config, admin settings, client capability discovery, route guards, and tests. Feature flags are required for phased rollout, self-hosted policy control, classroom/org restrictions, experiments, and cost containment.

## Where we are today

Shipped:
- Agent chat loop (user ↔ agent) with Claude Code, Claude API, OpenClaw, and HTTP connectors.
- Deterministic spell-check (nspell) → Opus error explanation pipeline.
- Sonnet-based vocabulary + grammar-gap extraction, FSRS concept scheduling.
- Translation/transliteration/phonetics pipeline for message display.
- turbopuffer storage/search adapter with table-scoped namespaces, durable Filo JSON, and a corpus BM25 index. Svelte 5 frontend, Hono backend.

Known broken or missing:
- Claude Code agent replies aren't streamed — the UI hangs for ~10–30 s per turn.
- No streaming, no typing indicator, no progress feedback during the SDK roundtrip.
- Multi-user authorization is application-enforced; it needs continued adversarial route testing because turbopuffer does not provide application-user RLS.
- No audio (TTS), no listening exercises, no review UI beyond an API endpoint.
- No reference links on corrections. User sees the error but can't deep-dive.
- No CEFR assessment. Level is self-declared and never updated.
- No usage/cost dashboard; ANTHROPIC_API_KEY spend is opaque.
- No global AI-off mode and no systematic per-feature flag registry.
- No Docker-compose, no desktop packaging, no release process.
- Tests cover FSRS core, concept scheduling, and legacy SM-2. No eval harness or L1-interference fixtures.

## Phase 0 — Stabilize the current build (exit: usable for dogfooding)

Prerequisite for everything else. Everything in this phase is bug fix or missing-but-small.

1. Fix session persistence. `App.svelte` gates on `profile.value` but should gate on `session.value`. `api.ts` wipes localStorage on first refresh failure; only clear on `invalid_grant` / `refresh_token_not_found`.
2. Stream Claude Code replies. Pass `includePartialMessages: true`, buffer `content_block_delta` events, emit SSE to the browser. Target: first-token latency visible within 2 s.
3. Surface agent errors in the UI (in-flight — `agent_error` field is wired, needs styling pass and retry button).
4. Usage telemetry. After each `SDKResultSuccess`, record `total_cost_usd` + token usage per user, per conversation. New table `usage_events`. Per-user daily total exposed via `/api/profile`.
5. Feature flag foundation. Add a central registry for every feature, with explicit `ai_dependent` metadata and dependency rules. Expose `/api/capabilities` to the client, guard disabled routes server-side, and add a global `AI_ENABLED` / admin setting that turns off all AI-dependent features while leaving deterministic NLP, conventional MT, and human-generated resource workflows available.
6. Dev docs. `README.md` with 60-second-setup. `.env.example` with every required key, including the global AI toggle and feature-flag overrides. `docs/DEVELOPING.md` for the contributor path.

**Exit:** a new contributor can clone, `bun install && bun run dev`, sign up, and hold a 10-turn French conversation with Claude Code without hitting a known bug.

## Phase 1 — The learning model becomes real (exit: measurable progress)

Per research in `docs/LEARNING-MODEL.md`. This is the core product.

1. Schema: add `review_log` (every review event, forever — required for FSRS parameter fitting) and `reference_links` (deterministic link catalog — see `docs/REFERENCES.md`). Widen `grammar_gaps` with `l1`, `cefr_target`, and `concept_id`.
1a. **FSRS as the default scheduler.** SM-2 was the 2024 ship-it choice; by mid-2026 the evidence is one-sided (Anki defaults to FSRS, open-spaced-repetition benchmark shows FSRS-6 beats SM-2 for ~99.5% of users, 20–30% fewer reviews for the same retention, ±5.3% scheduling-accuracy vs SM-2's ±16.2% at 90% retention). Langouste now schedules `concept_srs` rows with FSRS-6, keyed by atomic `(user_id, language, concept_id)` rather than by card/item. `fsrs_configs` makes both the 21 FSRS parameters and interaction signal weights tuneable per learner/language.
2. L1-biased error prompt. User profile stores `base_languages[0]` already; Opus prompt prepends an L1-interference-primer paragraph derived from Swan & Smith's *Learner English*. Start with 4 L1s (EN, ES, FR, DE); add a canonical list per target.
3. CEFR band estimator. Nightly job computes features (MLU, type-token ratio, subordination ratio, error rate, lexical rarity) from the user's last 100 messages per target language. Emits a band (`A2–B1`) plus confidence. Writes `assessments` row. UI shows the band in the profile, not a point.
4. Reference links on corrections. For each `Correction`, attach up to three links (Wiktionary conjugation anchor, a concept-page link from the per-language curated map in `docs/REFERENCES.md`, a Tatoeba example-sentence URL). Render as "Learn more" chips under the explanation.
5. Scaffolded reveal. Error-explanation flow: first attempt shows only the squiggle + concept hint. After a second failed self-correction on the same span, show the fix inline.
6. Review UI. Proper interleaved daily-review screen with vocabulary and grammar-gap items mixed (not segmented). One-tap quality rating (0–5), playback of IPA, reveal of context sentence.
7. Two-sided comprehensibility gate on Claude Code replies (agent-chat surface only — see `docs/LEARNING-MODEL.md` § "Comprehensible input across surfaces" for the per-surface table; other surfaces have different scaffolding and therefore different budgets). The agent-chat surface most closely resembles Hu & Nation 2000's unaided-extensive-reading condition, so Nation's 95% threshold is the right ceiling here. The gate has both a *ceiling* and a *floor*, because adaptive-difficulty trials (2024–2025) consistently beat both pure-input-flooding and pure-simplification on retention and self-efficacy, and Schmidt's noticing hypothesis predicts that 100% coverage is the *worst* condition for acquisition. Before each agent turn, pass the subagent two compressed payloads: (a) the user's known-lemma set with the instruction "target ≥95% coverage against this set; gloss any rarer word in parentheses in the learner's L1 on first use"; and (b) up to 3 stretch concepts drawn from the user's current `grammar_gaps`, with the instruction "include at least one natural exemplar of each in this turn, in context, without flagging it." Storage: a `known_lemmas` materialised view per user plus a `stretch_concepts` rolling selector. A post-turn verifier re-parses the reply through `docs/PARSING.md` and rejects (with a retry-prompt to the subagent) any reply that breaches either the ceiling or fails to land at least one stretch exemplar. Longer term, agent replies should be increasingly grounded in native-speaker-authored scenario packs and natural example corpora rather than free-form synthetic dialogue.
8. Empirical learning loop (foundational infrastructure — see `docs/LEARNING-MODEL.md` § "Empirical learning loop"). Opt-in anonymized telemetry on signup (off by default in self-hosted single-binary mode, prompt-on-first-launch in the managed tier), payload schema documented in `docs/TESTING.md`. Lightweight experiment harness that can route a fraction of opted-in users to alternative settings on any pedagogical default (per-surface coverage targets, FSRS parameters, scaffolded-reveal timing, exposure → practice → recall thresholds). Each experiment carries a hypothesis and a stop rule. Outcome metrics include notice-events, 30-day retention, comprehension-gate correctness, self-correction success, session length, return frequency, and explicit thumbs. Monthly automated digest of "where data agrees vs disagrees with the literature." Without this loop, every pedagogical claim in the doc stays a prior forever; with it, Langouste compounds.

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
2. Role-play scenarios. Pre-built conversation contexts ("order coffee in Paris", "job interview in Berlin"). Stored as templates with L1/L2, goal, success criteria. Scenarios should be native-speaker-authored or native-speaker-reviewed, with realistic register, cultural constraints, and natural sample turns. The agent adapts and responds inside the scenario; it should not invent the pedagogical core from scratch.
3. Conversation replay. Saved session transcripts, re-playable as listening exercises later.
4. Targeted practice sessions. Given `grammar_gaps` for a user, spawn a focused 10-turn Claude Code session that uses only that grammar structure.
5. Cost caps. Per-user monthly USD ceiling. The SDK does not enforce this — we do, by rejecting new turns when the ceiling is hit.

**Exit:** Langouste can be described in one sentence to a language teacher and have them say "I'd use that with my students."

## Phase 4 — Ship it (exit: real users not on this laptop)

Everything in phases 0–3 assumes the developer's machine. This phase makes the thing installable.

1. Docker bundle: Langouste configured with a hosted or BYOC turbopuffer
   endpoint. A single container plus server-side secrets brings the app up on a
   fresh host; no companion search/database stack is required.
2. Tauri desktop app. Wraps the Vite build + Bun backend. Signed for macOS, Windows, Linux AppImage. This is the "my grandma can install it" tier.
3. Sandboxed tool use. When Claude Code has tools enabled (Bash, Read, Edit), execute them inside a Docker scratch container mounted at `/workspace`. Network off by default. "Trusted mode" toggle for users who want host access.
4. Observability. Structured JSON logs, OpenTelemetry traces around each turn, a simple admin dashboard showing turns/day, cost/day, error rate.
5. Release process. Semver, changelog, GitHub Actions matrix build (Linux/macOS/Windows), automated migration check against a fresh DB.
6. Public beta. OSS on GitHub, an issue template, a Discord, and — critically — a way for users to opt-in to upload redacted session telemetry for evaluation (see `docs/TESTING.md` on the eval harness).

**Exit:** someone who didn't write the code can install it and reach first-useful-turn within five minutes on a clean machine.

## Post-v1 directions

Features that aren't promised for v1 but are explicit forward bets — captured so they don't get rediscovered as "new ideas" in eighteen months.

1. **Annotated real-media surfaces and content partnerships.** Extend the chat learning loop to native and instructional media: podcast transcripts, YouTube captions, specialized tutorial platforms, course clips, articles, public-domain literature, songs where licensing permits, film/TV subtitles via clean corpora, and later other media providers. The core artifact is an annotation-backed reader/player where every transcript span has character offsets, source timing, translation spans, vocabulary metadata, grammar annotations, pronunciation notes, and concept IDs. UX should support word-level and phrase-level translation on hover/tap, including the split interaction where word help appears above and phrase help appears below the text. Strategy is partnership-led by language: find high-quality content providers for each language and make their existing material learnable instead of trying to manufacture a whole curriculum from scratch. This is the main content direction for Langouste: source natural language first, then use AI to annotate, scaffold, segment, quiz, and schedule review from that source. New state: `content_sources`, `content_items`, `content_segments`, transcript alignment, content-completion progress, licensing/attribution metadata, and encounter events linked to content offsets/timestamps.
2. **University/classroom adjunct.** A teacher-facing layer for assigning or structuring real-world content while Langouste provides inline translation, grammar help, vocabulary tracking, review scheduling, and progress evidence. This requires org/course/classroom RBAC, teacher dashboards, assignment objects, due dates, consent boundaries for student profile visibility, and exportable progress reports. It is post-v1 because the product has to be useful for individual learners before it is credible in a classroom.
3. **Flashcard generation — printable and printed.** Every review item already has the content of a flashcard (front: target-language term or cloze; back: L1 gloss + IPA + one media or Tatoeba example + concept tag). Two deliverables:
   - **Local PDF export.** "Print my next 100 due cards" or "Print my A2 verb-conjugation deck." Renders to a print-ready PDF in standard index-card layouts (3×5, 4×6, Avery 5388, A6 perforated) with cut marks. Reuses the existing review-card data model; no new domain. Lives behind a `/api/decks/:id/export.pdf` route. Pure local feature, no fulfillment.
   - **Printed-and-shipped cards on real stock.** Optional paid service: user picks a deck, we render to a print-partner spec (Moo, MakePlayingCards, or a regional alternative for non-US shipping), they ship 300gsm linen-finish cards in a tuck box. Revenue path that doesn't require putting any pedagogical content behind a paywall. Adds order/payment/fulfillment surfaces we don't have yet (Stripe + a print-partner adapter); worth it for the physical-artifact moat — nobody else in this space ships a thing you can hold.
   - Both modes share the same renderer; the print-shop path is a different output target for the same PDF generator.
4. **Native-speaker-authored content packs.** Commission or partner for small, high-quality packs per language and level: dialogues, graded micro-stories, pronunciation minimal pairs, cultural scripts, workplace/travel/school scenarios, and teacher notes. AI can tag concepts, estimate CEFR, create cloze variants, and generate review prompts, but the canonical target-language content should come from native speakers or qualified teachers.
5. **Generated consumable media at the user's exact level as fallback.** See `docs/REFERENCES.md` § "Future: Langouste-generated media (pool 3)" — composer + verifier pipeline targeting 95–98% comprehensibility on the user's known-lemma set plus stretch concepts, producing reading passages, dialogues, podcast-style audio, eventually short video. This should be used sparingly: prefer natural content and native-speaker-authored packs, and use generation mainly to bridge gaps where sourced content cannot hit the learner's level, goal, or required concept combination.
6. **Langouste-authored per-concept reference pages.** See `docs/REFERENCES.md` § "Future: Langouste's own reference content." These should be edited/reviewed by fluent speakers or teachers for each supported language before being treated as canonical.
7. **Human pairings — instructors, pen pals, conversation partners.** The agent-chat model gets you a tireless interlocutor, but at some point every learner benefits from real humans. Three tiers, all opt-in:
   - **Paid instructors.** A marketplace of vetted teachers. Differentiator vs. iTalki / Preply: the instructor opens a session with full read access to the learner's CEFR band, current `grammar_gaps`, recent error patterns, and known-lemma set (subject to learner consent on share scope). The first ten minutes of any new pairing isn't wasted on placement — the teacher already knows. Lesson transcripts feed back into the same parsing pipeline as agent chats, so concept tracking is continuous across humans and agents.
   - **Pen pals — async, matched on complementary L1/L2.** Classic language-exchange model (you teach me English, I teach you French), but matched by Langouste on overlapping interests, time zones, and current bands so the conversation has somewhere to go. Messages flow through the same correction + concept-extraction pipeline either party can opt to share corrections back with their partner, or keep them private.
   - **Group conversation rooms.** Scheduled small-group voice or text rooms around a topic ("ordering coffee in French", "talking about your week in Spanish") with a mix of learners at the same band. Optionally moderated by an instructor; optionally moderated by an agent that steers the conversation and posts a per-participant correction summary at the end.
   - This breaks the current architectural rule that "every conversation has exactly one `agent_connector_id`" (see `CLAUDE.md`). That rule is right for v1 — it keeps the surface area small. Lifting it post-v1 means adding a participant model, RLS policies for cross-user message visibility, scheduling, payments for the instructor tier, and moderation tooling. Big lift, but it's where Langouste stops being "an AI tutor" and becomes "the place you learn this language, period."

## Non-goals for v1

Listed so we don't drift. Each has a defensible reason.

- **Mobile native apps.** PWA + Tauri covers most of the audience. Native iOS/Android is a six-month sidequest.
- **Self-hosted model inference (Ollama, llama.cpp).** Claude is the product. Swappable models is a distraction until after v1.
- **Teacher/classroom mode.** Captured above as a post-v1 direction, but it requires org/course RBAC, assignments, student privacy controls, and teacher reporting.
- **Group chats with multiple human learners.** Already ripped out; don't re-add.
- **Formal CEFR placement test.** The band estimator is honest about uncertainty; a formal test has its own failure modes and buys less than you'd think.
- **Gamified streaks.** Duolingo's worst idea. Intentionally absent.
- **AI-generated curriculum as the default content source.** AI can adapt, annotate, explain, and quiz. The default source of target-language content should be native speakers and natural media.

## Risk register

- **Claude API cost explosion.** Each message is a Sonnet vocab-extraction + possibly an Opus error explanation + a Claude Code turn. Back-of-envelope: $0.05–0.20 per chat turn at current pricing. Mitigation: cost cap + cache the deterministic parts + switch vocab extraction to Haiku once the schema is stable.
- **Search-database transaction limits.** turbopuffer is not a relational transaction engine. Mitigation: keep writes behind `Database`, batch mutations, serialize in-process read-modify-write operations, and use conditional writes where cross-process concurrency becomes necessary.
- **Claude Code SDK API churn.** It's new. Mitigation: connector isolation in `src/services/agents/claude-code.ts` — the rest of the app doesn't know Claude Code exists.
- **Reference link rot.** URL patterns for Lingolia / Kwiziq may change. Mitigation: link registry stored in DB; a weekly job pings URLs and flags 404s.
- **Pedagogical claims outrunning evidence.** Don't market "CEFR-certified" or "proven to improve fluency" — we have no such evidence yet. Honest marketing in `docs/MARKETING.md`.
- **Synthetic-language drift.** If too much learner input comes from generated text, Langouste risks teaching bland, unnatural, or subtly incorrect usage. Mitigation: prefer sourced natural content, commission native-speaker-authored packs, require native review for canonical examples, and track `content_origin` (`natural`, `native_authored`, `ai_adapted`, `ai_generated`) on learning content.
