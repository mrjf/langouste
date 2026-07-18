# Plan 009 (SPIKE): Design streaming for Claude Code agent replies

> **Executor instructions**: This is a **design/spike** plan, not a
> build-everything plan. Produce a written design + a minimal proof-of-concept
> behind a flag, and a list of open questions — do NOT ship a full streaming
> rewrite from this plan. Stop at the decision points and report. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/services/agents/claude-code.ts src/services/agents/types.ts src/routes/api/messages.ts`

## Status

- **Priority**: P2 (direction)
- **Effort**: L (spike scope: M)
- **Risk**: MED
- **Depends on**: none (but 003 touches the same `processAgentReply` — sequence after 003 to avoid conflict)
- **Category**: direction
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

`docs/ROADMAP.md:38-39` names this as a known Phase-0 pain: *"Claude Code agent
replies aren't streamed — the UI hangs for ~10–30 s per turn. No streaming, no
typing indicator, no progress feedback."* The Claude Code connector is the
flagship agent; the hang is the single biggest UX drag and a stated blocker for
Phase 1. This spike defines *how* to stream — the interface change, the
transport, and the client update — and de-risks it with a minimal PoC before a
full build.

## Current state

- The connector interface returns a resolved string, not a stream:
  ```ts
  // src/services/agents/claude-code.ts:123-160
  async sendMessage(text: string): Promise<string> {
    ...
    for await (const msg of query({ prompt: text, options })) {
      if (msg.type === "result") { ... finalText = msg.result; }
    }
    return finalText;  // only the final result is surfaced
  }
  ```
  The SDK is **already** iterated as an async generator — partial messages are
  available but discarded. The Agent SDK supports `includePartialMessages`
  (streaming `content_block_delta` events).
- The interface `AgentConnection.sendMessage(text): Promise<string>`
  (`src/services/agents/types.ts`) is shared by all connectors (claude, openclaw,
  http, stub) — changing its shape ripples to every connector and to
  `processAgentReply` in `src/routes/api/messages.ts`, which persists one final
  message.
- The client renders a pending "agent working" bubble and replaces it when the
  reply lands (recent git history: "instant pending agent bubble", "agent reply
  fills the pending bubble"). CLAUDE.md says: **"Rely on Supabase Realtime for
  all live updates — no custom websocket code."** In sqlite mode there is no
  Realtime — so the transport must work in both modes (e.g. SSE from the Hono
  route, or incremental DB updates the client polls/subscribes to).

## Scope

**In scope** (spike deliverables):
- A design doc: `docs/streaming-design.md` (create).
- A **flag-gated** minimal PoC on the Claude Code connector only, proving
  partial text can flow to the client in **one** mode (pick sqlite/SSE — no
  Realtime dependency). Behind an env flag (default off) so it can't affect
  default behavior.
- `tests/services/` coverage for the connector's partial-emission path if the
  PoC adds a testable seam.

**Out of scope**:
- Rewriting `sendMessage` for all connectors.
- Client polish (typing animations).
- Supabase Realtime path (design it on paper; implement only the flag-gated
  sqlite/SSE PoC).

## Steps

### Step 1: Write the design doc

`docs/streaming-design.md` must decide and justify:
1. **Interface change**: how to surface partials without breaking non-streaming
   connectors. Recommend an **optional** streaming method
   (e.g. `sendMessageStreaming?(text, onDelta): Promise<string>`) so
   openclaw/http/stub keep the string API; only claude-code implements the
   streaming variant. Caller falls back to `sendMessage` when the streaming
   method is absent.
2. **Transport in both DB modes**: SSE from the message route for sqlite; how
   Realtime carries partials for supabase (incremental `messages` row updates
   vs a side channel) — respecting the "no custom websocket" rule.
3. **Persistence**: does each delta write to the DB, or only the final? (Likely:
   stream deltas over SSE for liveness, persist only the final message — so a
   reload shows the complete reply.)
4. **Interaction with plan 003**: enrichment still runs after the final text;
   confirm streaming doesn't reopen the "enrichment clobbers reply" issue.
5. **Open questions** list.

**Verify**: `docs/streaming-design.md` exists and covers the 5 points above.

### Step 2: Flag-gated PoC (claude-code + sqlite/SSE only)

Add `includePartialMessages: true` to the `query` options in `claude-code.ts`
**only when a flag is set** (e.g. `config.streamingEnabled`, default false —
add via `config.ts` per plan 006's pattern). Accumulate
`content_block_delta` text. Add an optional streaming method to the connector
interface and implement it for claude-code. Wire a single SSE route (or reuse an
existing streaming route pattern — note `audio-drills` already streams ndjson,
see `tests/services/audio-drill-routes.test.ts:108`) to forward deltas. Keep the
default (flag off) path byte-for-byte the current behavior.

**Verify**: with the flag **off**, `bun test tests/services` → all pass,
behavior unchanged. With the flag **on** in a manual/dev run, partial text is
observable. Do not make the flag default-on.

### Step 3: Report

Summarize what the PoC proved, the recommended interface, the remaining work to
productionize (supabase path, all-connector story, client UX), and the open
questions. This becomes the input to a future build plan.

## Done criteria

- [ ] `docs/streaming-design.md` exists and covers interface, transport (both
      modes), persistence, plan-003 interaction, open questions
- [ ] A flag-gated PoC exists; with the flag off, `bun test tests/services` and
      `bun run check` pass and default behavior is unchanged
- [ ] `grep -n "includePartialMessages" src/services/agents/claude-code.ts` →
      present but flag-guarded
- [ ] A written report of findings + recommended next build plan
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

- The Agent SDK version in use doesn't expose `includePartialMessages` /
  partial events — report the SDK version and stop.
- Streaming can't be done in sqlite mode without violating "no custom websocket"
  — report the constraint; SSE (a plain HTTP response, not a websocket) is the
  intended escape hatch, but confirm it fits the client.
- The PoC would require changing all connectors to work at all — that means the
  optional-method design failed; stop and rethink the interface.

## Maintenance notes

- Sequence after plan 003 (both edit `processAgentReply`).
- The productionization (all connectors + supabase + client UX) is a **separate
  build plan** authored from this spike's report.
