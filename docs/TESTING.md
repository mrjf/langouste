# Testing Strategy

Five layers, each with a different job. Confusing them produces either flaky CI or false confidence. The layers, from fastest-to-run to most-realistic:

1. **Unit** — pure functions in isolation. Sub-millisecond.
2. **Contract** — service-to-service interface verification with mocks.
3. **Integration** — real turbopuffer namespace, real HTTP, stubbed LLMs.
4. **End-to-end** — real browser, real backend, recorded-or-live LLMs.
5. **Pedagogical eval** — LLM-graded quality checks against fixed fixtures.

Each layer has its own tooling, frequency, and failure budget. Don't mix them.

## Layer 1 — Unit tests (bun:test)

What belongs here: pure functions, pure types, pure transformations. If it touches a network, the filesystem, or the database, it doesn't belong here.

Coverage targets:

- `src/services/spaced-repetition/sm2.ts` — 100%. Currently ~90%. Add tests for quality=0 and quality=5 extremes, overflow behaviour at huge interval_days.
- `src/services/spellcheck/tokenizer.ts` — covers word boundaries, apostrophes, hyphens, Unicode punctuation. Per-language fixtures.
- `src/services/spellcheck/detector.ts` — language detection accuracy at ≥ 95% on a 1k-sentence fixture per language.
- `src/lib/languages.ts` — the ISO mapping functions.
- The forthcoming `src/services/learner-state/` computations (MLU, TTR, subordination ratio) — against fixtures of 100 sentences per language with expected feature values.
- The FSRS module when it lands — parameter fitting reproducibility.

Runtime target: full unit suite < 2 s. Run on every save in watch mode.

```bash
bun run test
```

## Layer 2 — Contract tests

What belongs here: verifying that a service module's outputs conform to the schema its callers depend on, against mock inputs.

Examples:

- `error-explainer.test.ts`: given a fixed error input, does the result match `ErrorExplanationOutput`? Does every `explanations` entry have a key for every `base_language`?
- `vocabulary-extractor.test.ts`: given a mocked Claude response, does the service map the tool-use output correctly? What happens on missing fields?
- `agents/claude-code.test.ts`: given a mocked SDK message stream, does the connector capture `session_id` correctly? Does it throw on `SDKResultError`?
- `mcp/tools/due_reviews.test.ts` (Phase 3): given a mocked DB, does the tool return MCP-compliant JSON?

The trick is mocking. The Anthropic SDK is a class with async methods; we wrap it behind `services/ai/client.ts` so the mock is a single file. Agent SDK is mocked per-test by injecting a fake `AsyncIterable<SDKMessage>`.

Runtime target: full contract suite < 10 s. Run on PR and pre-commit.

## Layer 3 — Integration tests

What belongs here: API routes against a disposable turbopuffer namespace prefix,
with LLMs stubbed to deterministic responses.

Test harness:

- A restricted test API key targets a dedicated turbopuffer account or region.
- Each run gets an isolated `TURBOPUFFER_NAMESPACE_PREFIX` containing a UUID.
- `bun run migrate` validates the connection before the suite starts.
- The harness deletes only namespaces bearing that exact generated prefix.
- LLM calls go through a `SCENARIO_FIXTURES` env var that routes to recorded fixtures.

Suite covers:

- Auth flows: signup, login, session refresh, JWT expiry.
- Conversation lifecycle: create, message, switch agent, delete.
- Message pipeline: check → explain → send → post-processing. Assert each stage's DB side effects.
- SRS flow: trigger reviews, post quality, verify `review_log` entries and `next_review_at` deltas.
- MCP server tools: each tool returns MCP-spec-compliant payloads (Phase 3).
- Reference links: a correction's concept_id resolves to expected URL set.
- Storage schema: first-write schema creation is idempotent and every imported
  logical table can be queried back.

Runtime target: full integration suite < 2 min. Runs on PR.

## Layer 4 — End-to-end tests (Playwright)

What belongs here: user-facing flows through a real browser against a real backend. Existing suite at `tests/e2e/` is the skeleton.

v1 coverage:

- **Auth**: signup → automatic login → logout → back to login screen.
- **Persistence**: after login, closing and reopening the tab lands on the last active conversation.
- **New agent chat**: open dialog → create Claude connector → start chat → send first message → receive agent reply (streamed). Assert: typing indicator appears, first token arrives within 3 s, final text renders, cost appears in profile.
- **Self-correction loop**: send message with deliberate error → squiggle appears → explanation chip shown → fix message → second Enter → message sends.
- **Scaffolded reveal**: two failed correction attempts → corrected token is inlined in the explanation on the third.
- **Reference link chip**: click "Learn more" on a correction → opens correct Kwiziq/Wiktionary/etc URL in a new tab.
- **Review screen**: 10 vocab items due → review all → assert `next_review_at` moved forward, `review_log` has 10 entries.
- **Comprehension gate**: agent message arrives in target language → 15 s reveal delay → comprehension question → correct answer reveals L1 translation.
- **Agent switch mid-conversation**: swap Claude API for Claude Code connector → assert new session started, history preserved in UI.

Fixtures: a small set of `scenario.json` files drives deterministic Playwright runs — same questions, same expected error patterns, pre-recorded or stubbed LLM responses.

Runtime target: < 5 min total. Split into `@fast` and `@full` tags; PRs run `@fast`, nightly runs `@full`.

Avoid: flakiness from real LLM latency variance. Where real LLM output is needed, use `recordAndReplay` — record on first run, replay on subsequent runs. Invalidate recordings on a quarterly cadence or when the pipeline changes structure.

## Layer 5 — Pedagogical eval harness

Not a typical test suite. A graded-by-LLM quality harness run nightly against a curated fixture set. This catches regressions that all other layers miss.

Fixtures: 200 learner utterances per language, each hand-tagged with:

- `expected_errors`: the errors we expect to detect, with concept IDs.
- `expected_vocab`: the lemmas we expect to be extracted.
- `l1`: the learner's L1.
- `cefr`: the learner's band.
- `difficulty_band`: expected reply difficulty if the agent is comprehensible-input-aware.

Harness runs:

```bash
bun scripts/eval-pedagogy.ts --fixtures=assets/eval/fr/ --out=eval-results-$(date -I).jsonl
```

For each fixture, it replays the full pipeline (spell-check → explain → extract → agent-reply), captures outputs, and asks a judge model (Opus) to score each output against the expected tags:

- **Error detection recall**: did the pipeline find the expected errors?
- **Error detection precision**: did it invent errors that weren't there?
- **Explanation quality**: is the L1 explanation pedagogically sound? (1–5 rubric.)
- **Vocabulary extraction quality**: did it pick the learner-novel lemmas, not the already-known ones?
- **Reply comprehensibility**: is the agent reply at the target CEFR band, within 5% unknown words?
- **Concept mapping accuracy**: did Sonnet's category map to the correct concept_id?
- **Reference link relevance**: do the auto-attached URLs actually explain the error?

Each dimension emits a score per fixture, rolled up to language-level means. A dashboard tracks week-over-week drift. A 10% drop in any dimension blocks the next release.

This harness is *the* reason we ship responsibly. Without it, the product's pedagogy drifts silently as models, prompts, and templates change. With it, we have receipts.

Budget: ~$5/run at current token prices. Nightly is fine; per-PR eval is too costly. Per-release gate: full eval on every release candidate.

## Non-goals

- **100% line coverage.** It's a bad metric. The layers above cover what matters.
- **Mutation testing.** Overkill for our scale.
- **Visual regression testing.** Svelte + Vite is stable enough; eyeballs catch the rare CSS regression.
- **Load testing at v1.** Single-user-per-session means contention is low. Revisit in Phase 4.

## Real-integration tests

On top of the stub-based e2e suite, there's a parallel `tests/e2e-real/` directory with specs that exercise the **real** external services — no mocks, no stubs. These tests hit the Anthropic API, spawn actual Claude Code sessions via the Agent SDK, and talk to a locally-running OpenClaw gateway. They cost real tokens, take real time, and require real preconditions.

### Commands

```bash
bun run test:e2e:real          # all three real-connector specs
bun run test:e2e:openclaw      # just openclaw
bun run test:e2e:claude        # just direct Claude API
bun run test:e2e:claude-code   # just Claude Code SDK
bun run test:all:real          # unit + stub e2e + real e2e
```

### Preconditions

Each real spec preflight-checks its dependency and **skips loudly** if missing:

- **Claude + Claude Code**: `ANTHROPIC_API_KEY` in `.env` or the shell. Tests pin `claude-haiku-4-5-20251001` to keep per-run cost in the cents.
- **OpenClaw**: gateway must be listening on `127.0.0.1:18789`. Because the Langouste OpenClaw connector doesn't yet speak the token-auth challenge-response handshake, **start it without auth**:
  ```
  openclaw gateway --auth none --allow-unconfigured
  ```

### Architecture

- The same `tests/e2e/harness.ts` boots the backend with the isolated in-memory
  turbopuffer contract transport. For real tests it sets
  `LANGOUSTE_STUB_AI=false` so real LLM services are wired up, while
  `LANGOUSTE_TEST_MODE=true` keeps `/api/test/*` reset routes available.
- `playwright.config.real.ts` is the separate config pointing at `tests/e2e-real/`. 120s timeout per test for Claude Code's slower subprocess spawn.
- `tests/e2e-real/helpers.ts` provides preflight checks (`requireAnthropicKey`, `requireOpenclawGateway`), a `sendAndAwaitReply(text)` that defaults to Shift+Enter force-submit (bypassing the real Opus check pipeline for prompts in the "wrong" language), and a `waitFor(pred, ms)` poller for async post-send pipelines (real Sonnet vocab extraction takes a few seconds).

### What the specs cover

- **openclaw.spec**: real WebSocket round-trip through the gateway; history persists across reload.
- **claude.spec**: real Anthropic API turn; real Sonnet vocabulary extraction populates the vocab table with a production event in `review_log`.
- **claude-code.spec**: real SDK subprocess + `query()` iteration; per-connector `cwd` isolation; session_id resume across turns proves the SDK's memory holds ("remember 42" → "what number?" → agent answers 42 on turn 2).

### What they're NOT for

Real tests verify the connector round-trip and the pipeline wiring. They don't verify LLM *quality* — that's the evaluation harness in a future phase. A real test passes if a non-empty reply comes back, not if the reply is pedagogically sound.

## The testing ladder in practice

When you fix a bug:

1. Write the failing test at the **lowest layer that reproduces it**. A bug in `sm2.ts`? Unit. A bug in route auth? Integration. A bug in UI state transition? E2E.
2. Fix the bug.
3. Run the layer that matters, not the whole ladder. Ship the smallest diff.

When you add a feature:

1. Unit tests for any new pure functions.
2. Contract tests for new service interfaces.
3. Integration tests for new routes.
4. E2E for the user-visible flow.
5. Add the feature's fixtures to the eval harness if it affects pedagogy.

CI enforces layers 1–3 on every PR. Layer 4 runs on PR with `@fast` tag and nightly `@full`. Layer 5 runs nightly and on release-candidate tags.

## Tooling

- **Runner**: `bun:test` for layers 1–3. `@playwright/test` for layer 4. Custom scripts for layer 5.
- **Coverage**: `bun:test --coverage` emits LCOV; we post to Codecov on main pushes.
- **Fixtures**: versioned under `assets/fixtures/<language>/` per test layer. Kept in-repo — not vendored.
- **Fake LLMs**: `services/ai/client.ts` checks `process.env.SCENARIO_FIXTURES`. When set, routes to a `FakeAnthropicClient` that replays recorded responses by prompt-hash.
- **Database reset**: `bun scripts/reset-test-db.ts` nukes and re-migrates.

## What tests to write right now

In priority order, to get to "safe to merge" from the current state:

1. Contract test for `services/agents/claude-code.ts` — mock the SDK, assert session_id capture and resume.
2. Integration test for `POST /api/messages/:id` happy path with Claude connector — assert message row, agent message row, `usage_events` row.
3. Unit tests for the forthcoming `services/learner-state/features.ts` computations (MLU, TTR, subordination).
4. E2E test for streaming — new token appears within 3 s; final message replaces partials.
5. Eval harness scaffolding with 10 French fixtures. Expand to 200 before Phase 1 exit.

Everything else from the list above comes in as those features ship.
