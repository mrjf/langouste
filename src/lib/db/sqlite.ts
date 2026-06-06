import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Database as BunDatabase } from "bun:sqlite";
import { dataPath } from "../data-dir.ts";
import type { Database, DatabaseSet, Filter, Scalar, SelectOptions } from "./types.ts";

/**
 * SQLite-backed Database implemented with `bun:sqlite`.
 *
 * Key differences from the Supabase impl:
 *   - JSON columns are stored as TEXT; we serialise/deserialise on the
 *     boundary. Callers don't see the difference in most cases, but boolean
 *     values round-trip as 0/1 unless we coerce (see `hydrate()`).
 *   - There is no RLS; all queries run with full privilege. The DatabaseSet
 *     therefore returns the same Database instance for `admin` and
 *     `forUser()`.
 *   - Custom RPC functions are dispatched to an in-process registry in
 *     `rpc.ts` rather than round-tripping through Postgres.
 */

// Tables whose primary key is a single uuid-ish text column that Supabase
// auto-fills with gen_random_uuid(). In SQLite we don't have that default, so
// we generate a UUIDv7 client-side when the caller didn't supply one.
const AUTO_ID_COLUMNS: Record<string, string> = {
  profiles: "user_id", // caller must supply (comes from auth)
  users: "user_id", // caller supplies in local auth
  agent_connectors: "connector_id",
  conversations: "conversation_id",
  messages: "message_id",
  vocabulary: "vocab_id",
  grammar_gaps: "gap_id",
  concept_srs: "concept_state_id",
  fsrs_configs: "config_id",
  assessments: "assessment_id",
  review_log: "log_id",
  exercise_attempts: "attempt_id",
};

const JSON_COLUMNS = new Set([
  "learning_languages",
  "base_languages",
  "target_languages",
  "config",
  "translations",
  "transliterations",
  "phonetics",
  "filo_doc",
  "source",
  "corrections",
  "evidence",
  "before_state",
  "after_state",
  "payload",
  "phases",
  "parameters",
  "quality_weights",
]);

function toStorage(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (JSON_COLUMNS.has(k) && v !== null && typeof v !== "string") {
      out[k] = JSON.stringify(v);
    } else if (typeof v === "boolean") {
      out[k] = v ? 1 : 0;
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function hydrate(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON_COLUMNS.has(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function hydrateAll(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => hydrate(r) as Record<string, unknown>);
}

function autoFillId(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const idCol = AUTO_ID_COLUMNS[table];
  if (!idCol) return row;
  if (row[idCol] != null && row[idCol] !== "") return row;
  return { ...row, [idCol]: Bun.randomUUIDv7() };
}

function filterClause(filters: Filter[], startIdx = 1): { sql: string; params: Scalar[] } {
  if (filters.length === 0) return { sql: "", params: [] };
  const params: Scalar[] = [];
  const parts: string[] = [];
  let idx = startIdx;
  for (const f of filters) {
    switch (f.op) {
      case "eq":
        parts.push(`"${f.column}" = ?${idx++}`);
        params.push(f.value);
        break;
      case "lt":
        parts.push(`"${f.column}" < ?${idx++}`);
        params.push(f.value);
        break;
      case "lte":
        parts.push(`"${f.column}" <= ?${idx++}`);
        params.push(f.value);
        break;
      case "in": {
        if (f.values.length === 0) {
          parts.push("0"); // false — empty IN matches nothing
          break;
        }
        const placeholders = f.values.map(() => `?${idx++}`).join(", ");
        parts.push(`"${f.column}" IN (${placeholders})`);
        params.push(...f.values);
        break;
      }
    }
  }
  return { sql: ` WHERE ${parts.join(" AND ")}`, params };
}

export class SqliteDatabase implements Database {
  constructor(private db: BunDatabase) {}

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    const cols = options.columns ?? "*";
    const { sql: where, params } = filterClause(options.filters ?? []);
    let sql = `SELECT ${cols} FROM "${table}"${where}`;
    if (options.order?.length) {
      const parts = options.order.map(
        (o) => `"${o.column}" ${o.ascending === false ? "DESC" : "ASC"}`,
      );
      sql += ` ORDER BY ${parts.join(", ")}`;
    }
    if (options.limit != null) sql += ` LIMIT ${options.limit}`;
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[];
    return hydrateAll(rows) as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    const rows = await this.select<T>(table, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const withId = autoFillId(table, row);
    const prepared = toStorage(withId);
    const cols = Object.keys(prepared);
    if (cols.length === 0) {
      throw new Error(`insert into ${table} with no columns`);
    }
    const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
    const quoted = cols.map((c) => `"${c}"`).join(", ");
    const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) RETURNING *`;
    const result = this.db.query(sql).get(...cols.map((c) => prepared[c] as Scalar)) as Record<
      string,
      unknown
    >;
    return hydrate(result) as T;
  }

  async upsert<T>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const withId = autoFillId(table, row);
    const prepared = toStorage(withId);
    const cols = Object.keys(prepared);
    const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
    const quoted = cols.map((c) => `"${c}"`).join(", ");
    const idCol = AUTO_ID_COLUMNS[table];
    const updateCols = cols
      .filter((c) => !conflictColumns.includes(c) && c !== idCol)
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(", ");
    const conflict = conflictColumns.map((c) => `"${c}"`).join(", ");
    const sql =
      `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ` +
      `ON CONFLICT (${conflict}) DO UPDATE SET ${updateCols} RETURNING *`;
    const result = this.db.query(sql).get(...cols.map((c) => prepared[c] as Scalar)) as Record<
      string,
      unknown
    >;
    return hydrate(result) as T;
  }

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    const prepared = toStorage(patch);
    const cols = Object.keys(prepared);
    if (cols.length === 0) return;
    const sets = cols.map((c, i) => `"${c}" = ?${i + 1}`).join(", ");
    const { sql: where, params: whereParams } = filterClause(filters, cols.length + 1);
    const sql = `UPDATE "${table}" SET ${sets}${where}`;
    const setParams = cols.map((c) => prepared[c] as Scalar);
    this.db.query(sql).run(...setParams, ...whereParams);
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    const prepared = toStorage(patch);
    const cols = Object.keys(prepared);
    if (cols.length === 0) {
      throw new Error(`updateOne on ${table} with empty patch`);
    }
    const sets = cols.map((c, i) => `"${c}" = ?${i + 1}`).join(", ");
    const { sql: where, params: whereParams } = filterClause(filters, cols.length + 1);
    const sql = `UPDATE "${table}" SET ${sets}${where} RETURNING *`;
    const setParams = cols.map((c) => prepared[c] as Scalar);
    const result = this.db.query(sql).get(...setParams, ...whereParams) as Record<
      string,
      unknown
    > | null;
    if (!result) throw new Error(`updateOne matched no rows in ${table}`);
    return hydrate(result) as T;
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    const { sql: where, params } = filterClause(filters);
    this.db.query(`DELETE FROM "${table}"${where}`).run(...params);
  }

  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const handler = rpcRegistry.get(name);
    if (!handler) {
      throw new Error(`Unknown RPC function: ${name}`);
    }
    return handler(this, args) as Promise<T>;
  }

  async raw<T>(sql: string, params: Scalar[] = []): Promise<T[]> {
    const rows = this.db.query(sql).all(...params) as Record<string, unknown>[];
    return hydrateAll(rows) as T[];
  }
}

/**
 * In-process RPC registry. SQLite has no plpgsql; we dispatch named functions
 * to TypeScript handlers that perform the same work.
 */
type RpcHandler = (db: SqliteDatabase, args: Record<string, unknown>) => Promise<unknown>;
const rpcRegistry = new Map<string, RpcHandler>();
export function registerRpc(name: string, handler: RpcHandler): void {
  rpcRegistry.set(name, handler);
}

export function createSqliteDatabaseSet(): DatabaseSet {
  const path = dataPath("langouste.db");
  const bun = new BunDatabase(path, { create: true });
  bun.exec("PRAGMA journal_mode = WAL");
  bun.exec("PRAGMA foreign_keys = ON");
  applySqliteSchema(bun);
  const db = new SqliteDatabase(bun);

  // SQLite has no row-level security; admin and per-user clients are the same.
  return {
    admin: db,
    forUser: () => db,
    async close() {
      bun.close();
    },
  };
}

function applySqliteSchema(db: BunDatabase): void {
  const schemaPath = resolve(import.meta.dir, "../../../sqlite/schema.sql");
  db.exec(readFileSync(schemaPath, "utf-8"));
  migrateReviewLogEventTypes(db);

  sqliteAddColumnIfMissing(db, "conversation_members", "last_read_at", "TEXT", () => {
    db.exec(
      "UPDATE conversation_members SET last_read_at = datetime('now') WHERE last_read_at IS NULL",
    );
  });

  for (const table of ["vocabulary", "grammar_gaps"]) {
    sqliteAddColumnIfMissing(db, table, "concept_id", "TEXT");
    sqliteAddColumnIfMissing(db, table, "encounters", "INTEGER NOT NULL DEFAULT 0");
    sqliteAddColumnIfMissing(db, table, "productions", "INTEGER NOT NULL DEFAULT 0");
    sqliteAddColumnIfMissing(db, table, "correct_productions", "INTEGER NOT NULL DEFAULT 0");
    sqliteAddColumnIfMissing(db, table, "self_corrected_productions", "INTEGER NOT NULL DEFAULT 0");
    sqliteAddColumnIfMissing(db, table, "last_encounter_at", "TEXT");
    sqliteAddColumnIfMissing(db, table, "last_produced_at", "TEXT");
  }
  sqliteAddColumnIfMissing(db, "vocabulary", "heard", "INTEGER NOT NULL DEFAULT 0");
  sqliteAddColumnIfMissing(db, "vocabulary", "spoken", "INTEGER NOT NULL DEFAULT 0");
  sqliteAddColumnIfMissing(db, "vocabulary", "last_heard_at", "TEXT");
  sqliteAddColumnIfMissing(db, "vocabulary", "last_spoken_at", "TEXT");
  sqliteAddColumnIfMissing(db, "messages", "filo_doc", "TEXT");
  sqliteAddColumnIfMissing(db, "audio_assets", "source", "TEXT");
  sqliteAddColumnIfMissing(db, "audio_assets", "filo_doc", "TEXT");

  cleanupPartialLearningRows(db);
}

function migrateReviewLogEventTypes(db: BunDatabase): void {
  const row = db
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_log'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'heard'")) return;

  db.exec(`
    ALTER TABLE review_log RENAME TO review_log_old_event_type;

    CREATE TABLE review_log (
      log_id         TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
      language       TEXT NOT NULL,
      item_type      TEXT NOT NULL CHECK (item_type IN ('vocabulary','grammar','concept')),
      item_id        TEXT,
      concept_id     TEXT,
      event_type     TEXT NOT NULL CHECK (event_type IN ('encounter','production','recall','heard','spoken')),
      outcome        TEXT CHECK (outcome IN ('correct','partial','incorrect')),
      quality        INTEGER CHECK (quality BETWEEN 0 AND 5),
      source         TEXT NOT NULL,
      message_id     TEXT,
      before_state   TEXT,
      after_state    TEXT,
      observed_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO review_log (
      log_id, user_id, language, item_type, item_id, concept_id, event_type,
      outcome, quality, source, message_id, before_state, after_state, observed_at
    )
    SELECT
      log_id, user_id, language, item_type, item_id, concept_id, event_type,
      outcome, quality, source, message_id, before_state, after_state, observed_at
    FROM review_log_old_event_type;

    DROP TABLE review_log_old_event_type;

    CREATE INDEX IF NOT EXISTS idx_review_log_user_lang ON review_log(user_id, language, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_review_log_item      ON review_log(item_type, item_id);
    CREATE INDEX IF NOT EXISTS idx_review_log_concept   ON review_log(concept_id);
  `);
}

function sqliteAddColumnIfMissing(
  db: BunDatabase,
  table: string,
  column: string,
  definition: string,
  backfill?: () => void,
): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  backfill?.();
}

function cleanupPartialLearningRows(db: BunDatabase): void {
  db.exec(`
    DELETE FROM vocabulary
    WHERE encounters = 0
      AND productions = 0
      AND correct_productions = 0
      AND self_corrected_productions = 0
      AND repetitions = 0
      AND NOT EXISTS (
        SELECT 1 FROM review_log
        WHERE review_log.item_type = 'vocabulary'
          AND review_log.item_id = vocabulary.vocab_id
      )
  `);
  db.exec(`
    DELETE FROM grammar_gaps
    WHERE encounters = 0
      AND productions = 0
      AND correct_productions = 0
      AND self_corrected_productions = 0
      AND repetitions = 0
      AND NOT EXISTS (
        SELECT 1 FROM review_log
        WHERE review_log.item_type = 'grammar'
          AND review_log.item_id = grammar_gaps.gap_id
      )
  `);
}
