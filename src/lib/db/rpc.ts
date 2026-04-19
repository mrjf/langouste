import { registerRpc } from "./sqlite.ts";

/**
 * SQLite equivalents of the Supabase Postgres functions defined in
 * supabase/migrations/*.sql. Register them at boot so that `db.rpc("name",
 * args)` works identically in both backends.
 *
 * Keep these handlers behaviour-identical to their SQL counterparts. If the
 * SQL changes, update here in the same commit.
 */

// Mirrors supabase/migrations/002_grammar_gap_upsert.sql
registerRpc("upsert_grammar_gap", async (db, args) => {
  const row = {
    user_id: args.p_user_id,
    language: args.p_language,
    category: args.p_category,
    description: args.p_description,
  };
  await db.raw(
    `INSERT INTO grammar_gaps (user_id, language, category, description)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (user_id, language, category) DO UPDATE SET
       error_count = grammar_gaps.error_count + 1,
       last_error_at = datetime('now'),
       description = excluded.description`,
    [row.user_id as string, row.language as string, row.category as string, row.description as string],
  );
  return null;
});
