# Plan 002: Add route tests that lock in auth and conversation-membership enforcement

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/routes/api/messages.ts src/routes/api/conversations.ts src/lib/auth/local.ts sqlite/schema.sql`
> If any in-scope-adjacent file changed, compare the "Current state" excerpts
> against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-conversation-idor.md (fixes must be in place, or the new tests will fail — which is the point)
- **Category**: tests
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

The repo has **no route-level tests** and no tests for auth or
conversation-membership enforcement — only `tests/services/sm2.test.ts` and
`fsrs.test.ts` cover critical logic. That means the IDOR fixes in plan 001 have
nothing stopping a future refactor from silently re-opening them, and a new
contributor cannot verify access control locally. This plan adds an integration
test that boots the real Hono message and conversation routes against a real
sqlite database and asserts: (a) no token → 401, (b) valid token but not a
member → 403, (c) member → 200. It is the regression net for plan 001 and the
first template for testing any other protected route.

## Current state

- Routes are plain Hono apps mounted under `/api/*`; each calls
  `messageRoutes.use("*", requireAuth)` (`src/routes/api/messages.ts:61`) /
  `conversationRoutes.use("*", requireAuth)` (`src/routes/api/conversations.ts:20`).
  A Hono app can be driven in-process with `app.request(url, init)` — see the
  existing pattern in `tests/services/audio-drill-routes.test.ts` (it calls
  `routes.request("http://local/...")`).

- `requireAuth` (`src/routes/middleware.ts:18`) reads the `Authorization: Bearer <token>`
  header. In sqlite mode it validates the token with `validateToken` and binds
  `c.set("db", adminDb())` + `c.set("userId", ...)`.

- **Auth in tests**: sqlite mode issues a real local JWT. To get a valid token
  for a specific user, use `signup(email, password)` from
  `src/lib/auth/local.ts:70`, which returns a `LocalSession`:
  ```ts
  interface LocalSession { access_token: string; expires_at: number; user: { id: string; email: string } }
  ```
  `signup` writes to the `users` table via `adminDb()`. The JWT is HS256 signed
  with `config.jwtSecret` (= `LANGOUSTE_JWT_SECRET`).

- **Database in tests**: the DB is a local sqlite file at
  `dataPath("langouste.db")`; `dataPath` resolves under `LANGOUSTE_DATA_DIR`
  (`src/lib/data-dir.ts:48`). The schema lives at `sqlite/schema.sql` and is a
  set of `CREATE TABLE IF NOT EXISTS` statements. `scripts/migrate.ts`
  (`runSqliteMigrations`) applies it by:
  ```ts
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync("sqlite/schema.sql", "utf-8"));
  ```
  Reuse exactly this bootstrap in the test's `beforeEach`.

- **Env the config layer requires in sqlite mode** (`src/lib/config.ts`):
  `DATABASE_MODE=sqlite`, `ANTHROPIC_API_KEY` (any value — never called),
  `LANGOUSTE_JWT_SECRET`. Set `LANGOUSTE_DATA_DIR` to a temp dir so each test
  run gets a fresh DB. **Set these env vars BEFORE the first import of any
  module that transitively loads `src/lib/config.ts`** — `config.ts` reads
  `process.env` at module-evaluation time. The existing tests handle this by
  doing dynamic `await import(...)` *inside* the test after setting env in
  `beforeEach` (see `tests/services/audio-drill-routes.test.ts:16-22` and
  `tests/services/language-strategy.test.ts:6-8`). Follow that pattern: set env
  first, then `await import` the route module.

- **Seeding a conversation + members**: use the database services directly (via
  `adminDb()`) rather than HTTP, to keep the test focused on the guard:
  - `createConversation(db, userId, agentConnectorId)` and
    `addMember(db, { conversation_id, user_id, target_languages, base_languages })`
    from `src/services/database/{conversations,members}.ts`.
  - A minimal member row: `target_languages: [{ lang: "hu", cefr_level: "A1" }]`,
    `base_languages: ["en"]`.
  - `createConversation` requires an `agent_connector_id`; insert a throwaway
    connector first via `adminDb().insert("agent_connectors", {...})` **or**, if
    the FK makes that fragile, pass a generated UUID and confirm the schema
    allows it. If the connector FK blocks insertion, that is a STOP condition —
    report it and ask whether to relax the fixture.

**Convention to match**: model the file structure on
`tests/services/audio-drill-routes.test.ts` — `beforeEach`/`afterEach` that
create and `rm` a temp dir, save/restore the same four env vars
(`ANTHROPIC_API_KEY`, `DATABASE_MODE`, `LANGOUSTE_JWT_SECRET`,
`LANGOUSTE_DATA_DIR`), and dynamic `import` of the route module inside each test.

## Commands you will need

| Purpose    | Command                                                        | Expected on success        |
|------------|---------------------------------------------------------------|----------------------------|
| Run new test | `bun test tests/services/conversation-access.test.ts`       | all pass                   |
| Full suite | `bun test tests/services`                                      | all pass                   |
| Lint/format | `bun run check`                                              | exit 0                     |

## Scope

**In scope** (the only files you should create/modify):
- `tests/services/conversation-access.test.ts` (create)

**Out of scope** (do NOT touch):
- Any `src/` file — if a test fails because a route lacks a guard, that is a
  finding for plan 001, not something to fix here. Report it.
- `sqlite/schema.sql` — read it, don't edit it.
- Other test files.

## Git workflow

- Branch: `advisor/002-route-auth-membership-tests`
- Commit style: imperative subject, e.g. `test: cover conversation membership enforcement on message routes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scaffold the test file with DB + env bootstrap

Create `tests/services/conversation-access.test.ts`. In `beforeEach`:
1. Set `process.env.DATABASE_MODE = "sqlite"`,
   `process.env.ANTHROPIC_API_KEY ||= "test-key"`,
   `process.env.LANGOUSTE_JWT_SECRET = "test-secret"`.
2. `rootDir = await mkdtemp(join(tmpdir(), "langouste-access-"))` and
   `process.env.LANGOUSTE_DATA_DIR = join(rootDir, "db")`.
3. Create the DB directory and apply the schema using the bootstrap shown in
   "Current state" (open `bun:sqlite`, exec pragmas, exec `sqlite/schema.sql`
   read from `resolve(process.cwd(), "sqlite/schema.sql")`). Close that handle
   after exec so the app opens its own.

In `afterEach`, restore the four saved env vars and `rm(rootDir, { recursive: true, force: true })`.

**Verify**: `bun test tests/services/conversation-access.test.ts` → runs (may
report 0 tests so far). No unhandled errors about missing env or missing tables.

### Step 2: Add a helper that mints a user + token and a seeded conversation

Inside the test file, add an async helper (called within a test, after env is
set) that:
1. `await import`s `signup` from `src/lib/auth/local.ts`, calls
   `signup("a@test", "pw-aaaaaa")` → returns session A; repeat for
   `signup("b@test", "pw-bbbbbb")` → session B. Capture `access_token` and
   `user.id` for each.
2. Seeds a conversation owned by user A: dynamic-import `createConversation`
   and `addMember`, create a conversation for A and add A as a member (langs as
   in "Current state"). Handle the connector FK per the note above.
3. Returns `{ tokenA, tokenB, userIdA, userIdB, conversationId }`.

**Verify**: a temporary `test("seeds", ...)` that calls the helper and asserts
`conversationId` is a non-empty string → passes. Remove or keep this smoke test.

### Step 3: Assert the message-read guard (401 / 403 / 200)

Add `test("GET /messages/:id enforces membership", ...)`:
1. `await import` the message routes: `const { messageRoutes } = await import("../../src/routes/api/messages.ts")`.
2. No auth header → `messageRoutes.request(\`http://local/${conversationId}\`)`
   → expect status **401**.
3. User B's token (not a member) →
   `messageRoutes.request(\`http://local/${conversationId}\`, { headers: { Authorization: \`Bearer ${tokenB}\` } })`
   → expect status **403**.
4. User A's token (member) → same call with `tokenA` → expect status **200**,
   and the body is an array (`expect(Array.isArray(await res.json())).toBe(true)`).

**Verify**: `bun test tests/services/conversation-access.test.ts` → this test
passes. If step-3 case (3) returns 403 for the member, STOP — the route or seed
is wrong.

### Step 4: Assert the connector-swap guard (403 for non-member)

Add `test("PATCH /conversations/:id/connector enforces membership", ...)`:
1. `await import` the conversation routes.
2. Create a connector owned by user B (so B passes the ownership check but must
   still fail membership): insert via `adminDb().insert("agent_connectors", { ...created_by: userIdB })`
   — inspect `sqlite/schema.sql` for the `agent_connectors` columns and provide
   the required non-null ones.
3. User B PATCHes A's conversation to that connector →
   `conversationRoutes.request(\`http://local/${conversationId}/connector\`, { method: "PATCH", headers: { Authorization: \`Bearer ${tokenB}\`, "Content-Type": "application/json" }, body: JSON.stringify({ agent_connector_id: <B's connector id> }) })`
   → expect status **403**.

**Verify**: `bun test tests/services/conversation-access.test.ts` → all tests
pass.

### Step 5: Full suite + lint

**Verify**:
- `bun test tests/services` → all pass (existing + your new tests).
- `bun run check` → exit 0.

## Test plan

New file `tests/services/conversation-access.test.ts`, modeled structurally on
`tests/services/audio-drill-routes.test.ts`, covering:
- `GET /api/messages/:conversationId`: missing token → 401; non-member → 403;
  member → 200 (array body).
- `PATCH /api/conversations/:conversationId/connector`: non-member (who owns the
  connector) → 403.

These four assertions are the regression net for plan 001. If plan 001 is not
yet merged, the 403 cases will FAIL (returning 200) — that failure is the proof
the tests are real; merge 001 first.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `tests/services/conversation-access.test.ts` exists
- [ ] `bun test tests/services/conversation-access.test.ts` exits 0, ≥ 4 assertions across the described cases
- [ ] `bun test tests/services` exits 0 (no regression in the existing suite)
- [ ] `bun run check` exits 0
- [ ] Only `tests/services/conversation-access.test.ts` is added/modified (`git status --porcelain`)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Applying `sqlite/schema.sql` errors, or the tables `users`, `conversations`,
  `conversation_members`, `agent_connectors` are not created by it (schema
  drift since this plan was written).
- `signup` no longer returns `{ access_token, user: { id } }`.
- Seeding a conversation is blocked by an FK or NOT NULL constraint you can't
  satisfy from schema inspection (report the exact constraint).
- The non-member 403 cases return 200 even though plan 001 is merged (means the
  guard didn't take — a real bug; report, don't paper over it).
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- This file is the template for future protected-route tests. When adding a new
  route that takes an object ID, add a non-member-403 case here or in a sibling
  file.
- If auth moves off local JWT (e.g. a future refactor), the token-minting helper
  in step 2 is the single place to update.
- Deferred: parameterizing these tests to also run against Supabase mode is out
  of scope (needs test Supabase creds) — noted for a later plan.
