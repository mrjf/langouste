# Plan 001: Enforce conversation membership on message-read and connector-swap routes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/routes/api/messages.ts src/routes/api/conversations.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

Two authenticated endpoints act on a conversation by ID without checking that
the caller is a member of that conversation (an IDOR — Insecure Direct Object
Reference). In the default **sqlite** deployment the per-request database is
`adminDb()` (no row-level security — see `src/routes/middleware.ts:46`), so
these are the *only* access-control gates that exist. Concretely:

1. `GET /api/messages/:conversationId` returns the full message history of **any**
   conversation whose ID a logged-in user can guess or enumerate — leaking
   another user's private learning content, corrections, and agent replies.
2. `PATCH /api/conversations/:conversationId/connector` lets any logged-in user
   repoint **any** conversation at a connector they own, hijacking someone
   else's conversation.

Every sibling route in the same files already performs this check with
`getMember(...)`. This plan adds the same guard to the two that are missing it.
After it lands, both routes reject non-members with HTTP 403.

## Current state

- `src/routes/api/messages.ts` — message routes; all mounted behind
  `requireAuth` (line 61). The GET handler is the hole:

  ```ts
  // src/routes/api/messages.ts:67-76
  messageRoutes.get("/:conversationId", async (c) => {
    const db = c.get("db");
    const conversationId = c.req.param("conversationId");
    const before = c.req.query("before");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    const messages = await getMessages(db, conversationId, limit, before);
    return c.json(messages);
  });
  ```

  The correct pattern already exists a few lines below in the same file (the
  `/check` handler):

  ```ts
  // src/routes/api/messages.ts:92-95
  const senderMember = await getMember(db, conversationId, userId);
  if (!senderMember) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }
  ```

  `getMember` is already imported at line 9. `userId` is available via
  `c.get("userId")` (used at line 81 in the `/check` handler).

- `src/routes/api/conversations.ts` — conversation routes; all behind
  `requireAuth` (line 20). The connector-swap handler is the hole:

  ```ts
  // src/routes/api/conversations.ts:62-79
  conversationRoutes.patch("/:conversationId/connector", async (c) => {
    const db = c.get("db");
    const userId = c.get("userId");
    const conversationId = c.req.param("conversationId");
    const { agent_connector_id } = await c.req.json();

    if (!agent_connector_id) {
      return c.json({ error: "agent_connector_id is required" }, 400);
    }

    const connector = await getConnector(db, agent_connector_id);
    if (!connector) return c.json({ error: "Connector not found" }, 404);
    if (connector.created_by !== userId) return c.json({ error: "Forbidden" }, 403);

    await setConversationConnector(adminDb(), conversationId, agent_connector_id);
    const enriched = await getConversation(db, conversationId);
    return c.json(enriched);
  });
  ```

  This checks connector ownership but never conversation membership.
  `getMember` is **not yet imported** in this file. The other handlers here
  already import members helpers — see line 9-13
  (`import { addMember, markConversationRead, updateMemberLanguages } from "../../services/database/members.ts";`)
  and the read/languages handlers below use `getMember` from the same module.

- `getMember` signature (do not change it):
  ```ts
  // src/services/database/members.ts:14
  export async function getMember(db: Database, conversationId: string, userId: string): Promise<ConversationMember | null>
  ```

**Convention to match**: the membership guard is always
`const member = await getMember(db, conversationId, userId); if (!member) return c.json({ error: "..." }, 403);`
placed immediately after the params are read and before any data access. Use
`db` (the per-request database bound by `requireAuth`), not `adminDb()`, for the
membership lookup.

## Commands you will need

| Purpose   | Command                                              | Expected on success |
|-----------|------------------------------------------------------|---------------------|
| Lint/format | `bun run check`                                    | exit 0              |
| Unit tests | `bun test tests/services`                           | all pass            |
| Typecheck  | `bun run typecheck`                                 | exit 0 (see note)   |

Note on typecheck: CI runs it non-blocking; on a clean tree it currently
reports 0 errors. If it reports errors that clearly pre-date your change (not
in `messages.ts`/`conversations.ts`), that is acceptable — but your two files
must be error-free.

## Scope

**In scope** (the only files you should modify):
- `src/routes/api/messages.ts`
- `src/routes/api/conversations.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/routes/middleware.ts` — the auth/db binding is correct as-is; do not
  change how `db` is chosen per mode.
- `src/services/database/members.ts` — `getMember` is already correct.
- Any other route file — other IDOR-style checks are out of scope here; if you
  spot another missing check, note it in your report, do not fix it.
- Tests — plan 002 adds the route tests that prove these fixes. Do not write
  tests in this plan (but do run the existing suite to confirm no regression).

## Git workflow

- Branch: `advisor/001-fix-conversation-idor`
- Commit style matches the repo (short imperative subject; recent history uses
  `fix:` / plain imperative — e.g. `fix: enforce conversation membership on message read`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Guard `GET /api/messages/:conversationId`

In `src/routes/api/messages.ts`, inside the `messageRoutes.get("/:conversationId", ...)`
handler, add a `userId` read and a membership check **before** the
`getMessages` call. The handler should become:

```ts
messageRoutes.get("/:conversationId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const before = c.req.query("before");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const member = await getMember(db, conversationId, userId);
  if (!member) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  const messages = await getMessages(db, conversationId, limit, before);
  return c.json(messages);
});
```

**Verify**: `bun run check` → exit 0. Then
`grep -n "getMember(db, conversationId, userId)" src/routes/api/messages.ts`
→ at least 2 matches (the new one plus the existing `/check` one).

### Step 2: Guard `PATCH /api/conversations/:conversationId/connector`

In `src/routes/api/conversations.ts`:

1. Add `getMember` to the members import at the top (line 9-13):
   ```ts
   import {
     addMember,
     getMember,
     markConversationRead,
     updateMemberLanguages,
   } from "../../services/database/members.ts";
   ```
2. In the connector-swap handler, add a membership check immediately after
   `conversationId` is read (before the body parse / connector lookup):
   ```ts
   const member = await getMember(db, conversationId, userId);
   if (!member) {
     return c.json({ error: "Not a member of this conversation" }, 403);
   }
   ```
   Keep the existing connector-ownership check as well — both must hold.

**Verify**: `bun run check` → exit 0. Then
`grep -n "getMember" src/routes/api/conversations.ts` → shows the import and the
new call.

### Step 3: Confirm no regression

**Verify**: `bun test tests/services` → all pass (same count as before your
change; you added no tests).

## Test plan

No new tests in this plan — plan 002 adds route-level tests that assert a
non-member gets 403 on both endpoints and a member gets 200. This plan's
verification is: existing suite still green, and the grep checks above confirm
the guards are present. Do not skip plan 002.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits 0
- [ ] `bun test tests/services` exits 0, all pass
- [ ] `grep -c "getMember(db, conversationId, userId)" src/routes/api/messages.ts` ≥ 2
- [ ] `grep -c "getMember" src/routes/api/conversations.ts` ≥ 2 (import + call)
- [ ] Only `src/routes/api/messages.ts` and `src/routes/api/conversations.ts` are modified (`git status --porcelain`)
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The GET handler in `messages.ts` or the connector-swap handler in
  `conversations.ts` does not match the "Current state" excerpts (the code has
  drifted — a guard may already have been added, or the handler moved).
- `getMember` is no longer exported from `src/services/database/members.ts`
  with the signature `(db, conversationId, userId)`.
- Adding the guard breaks an existing test (that would mean a test was relying
  on the missing check — report it rather than deleting the test).

## Maintenance notes

- Any new route that takes a `:conversationId` (or any per-object ID) must
  perform the same `getMember`/ownership guard before touching data — in sqlite
  mode there is no RLS backstop. A reviewer should treat a new ID-parameterized
  route without a membership/ownership check as a blocker.
- Follow-up deferred to plan 002: automated tests that lock in this behavior so
  a future refactor can't silently re-open the hole.
