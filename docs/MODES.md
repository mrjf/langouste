# Database modes

Langouste runs in one of two modes, chosen by the `DATABASE_MODE` environment variable. Same app, same features, different backing store.

The current local/dev setup uses `DATABASE_MODE=sqlite` and `VITE_DATABASE_MODE=sqlite` from `.env.example`. Treat that as the intended contributor/default setup. If `DATABASE_MODE` is omitted entirely, `src/lib/config.ts` currently falls back to `supabase`, so keep the mode explicit in `.env`.

| | `sqlite` (default) | `supabase` |
|---|---|---|
| **Stores data in** | a single `langouste.db` file in your OS data directory | a managed or self-hosted Supabase project |
| **Auth** | local bcrypt + HS256 JWT | Supabase Auth (email/password, OAuth etc.) |
| **Realtime** | none (request/response only) | Supabase Realtime websockets |
| **RLS** | none (app-level filters) | enforced by Postgres |
| **Users** | one-to-many supported, but aimed at single-user local | many-user multi-tenant |
| **External services** | Anthropic API only | Anthropic API + Supabase |
| **When to pick it** | running Langouste on your laptop; OSS contributors; desktop app | hosted tier; teams; anything with >1 human user |

## Running in `sqlite` mode

1. Copy `.env.example` to `.env`, leave `DATABASE_MODE=sqlite`, `VITE_DATABASE_MODE=sqlite`, and `VITE_SINGLE_USER=true`, then set `ANTHROPIC_API_KEY` and `LANGOUSTE_JWT_SECRET`.
2. `bun install`
3. `bun run migrate` — creates `langouste.db` in the data directory.
4. `bun run dev` — Vite on `:5173`, Hono on `:8000`.

The database file lives at:

- **macOS**: `~/Library/Application Support/Langouste/langouste.db`
- **Linux**: `$XDG_DATA_HOME/langouste/langouste.db`, or `~/.local/share/langouste/langouste.db`
- **Windows**: `%APPDATA%/Langouste/langouste.db`
- **Docker** (when we ship the image): `/data/langouste.db`

Override with `LANGOUSTE_DATA_DIR=/absolute/path`. Handy for dev: `LANGOUSTE_DATA_DIR=./data` keeps the DB next to the repo.

## Running in `supabase` mode

1. Create a Supabase project (or self-host one).
2. Copy `.env.example` to `.env`, uncomment the supabase block, fill in the keys, set `DATABASE_MODE=supabase` and `VITE_DATABASE_MODE=supabase`.
3. `supabase login` so the migrator can reach the Management API.
4. `bun run migrate` — applies incremental migrations from `supabase/migrations/`.
5. `bun run dev`.

## Switching modes

You can keep separate `.env` files and `cp` between them, or toggle with `DATABASE_MODE=sqlite VITE_DATABASE_MODE=sqlite bun run dev`. The two modes don't share data — switching means a fresh conversation history on the other side. (Data export/migration between modes is a future tool; ping the roadmap if you need it.)

## Invariants the abstraction preserves

- **Identical API surface.** Routes, types, and client JSON shapes are the same in both modes.
- **Identical pedagogy.** FSRS concept scheduling, Opus explanation, Sonnet vocabulary extraction all run the same way.
- **Per-request scoping.** In supabase mode, `c.get("db")` is scoped to the authenticated user's JWT (RLS respected). In sqlite mode, it's the admin DB (single-user context, no RLS exists).

## What sqlite mode intentionally drops

- **Multi-tab live sync.** New messages in tab A don't push to tab B — you'd refresh. Fine for single-user use.
- **Row-level security.** SQLite has none. App-level `WHERE user_id = $1` filters in `src/services/database/*` do the equivalent work; belt-and-braces.
- **Supabase Studio GUI.** Use `sqlite3 path/to/langouste.db` or a GUI like DB Browser for SQLite.

## Files that differ between modes

- `src/routes/middleware.ts` picks the JWT validator at boot.
- `src/routes/api/auth.ts` has both paths; the sqlite branch activates in sqlite mode.
- `src/services/database/conversations.ts` fans out the nested-select query for SQLite; Supabase uses PostgREST embedding.
- `src/lib/db/{sqlite,supabase}.ts` are the two backends behind the shared `Database` interface.

Everything else — `services/ai/*`, `services/agents/*`, `services/spaced-repetition/*`, the whole Svelte client — is mode-agnostic.
