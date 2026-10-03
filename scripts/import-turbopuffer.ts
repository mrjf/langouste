#!/usr/bin/env bun
/**
 * Non-destructively copy a legacy SQLite or Supabase dataset into
 * turbopuffer. Existing source data is never modified or deleted.
 *
 *   bun run import:turbopuffer --sqlite /path/to/langouste.db
 *   LEGACY_SUPABASE_URL=... LEGACY_SUPABASE_SECRET_KEY=... \
 *     bun run import:turbopuffer --supabase
 *   bun run import:turbopuffer --audio-drills-root ./data/audio-drills \
 *     --owner-id <user-id>
 */

import { Database as Sqlite } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FiloDocumentJson } from "filo";
import { adminDb, db, type Database } from "../src/lib/db/index.ts";
import { TABLE_NAMES, type TableName, tableDefinition } from "../src/lib/db/table-schema.ts";
import { corpusDocumentRow } from "../src/services/corpus/store.ts";
import { persistAudioDrillDirectory } from "../src/services/corpus/audio-drills.ts";

const args = process.argv.slice(2);
const sqliteFlag = args.indexOf("--sqlite");
const useSupabase = args.includes("--supabase");
const audioDrillsFlag = args.indexOf("--audio-drills-root");
const ownerFlag = args.indexOf("--owner-id");

if (sqliteFlag < 0 && !useSupabase && audioDrillsFlag < 0) {
  throw new Error(
    "Choose a source: --sqlite /path/to/langouste.db, --supabase, or --audio-drills-root /path",
  );
}
if (sqliteFlag >= 0 && useSupabase) {
  throw new Error("Choose only one source");
}

async function main(): Promise<void> {
  const source: LegacySource | null =
    sqliteFlag >= 0
      ? new SqliteSource(requiredArg(args[sqliteFlag + 1], "--sqlite requires a database path"))
      : useSupabase
        ? new SupabaseRestSource(
            requiredEnv("LEGACY_SUPABASE_URL"),
            requiredEnv("LEGACY_SUPABASE_SECRET_KEY"),
          )
        : null;
  const database = adminDb();
  if (!database.bulkUpsert) throw new Error("Configured database does not support bulk import");
  const imported = new Map<string, number>();
  const corpusRows: Record<string, unknown>[] = [];

  try {
    if (source) {
      for (const table of TABLE_NAMES) {
        if (table === "corpus_documents") continue;
        const rows = await source.read(table);
        if (rows.length === 0) continue;
        const hydrated = rows.map((row) => hydrateLegacyRow(table, row));
        await database.bulkUpsert(table, hydrated);
        imported.set(table, hydrated.length);

        for (const row of hydrated) {
          const document = validFiloDocument(row.filo_doc);
          if (!document) continue;
          const ownerId =
            stringValue(row.sender_id) ??
            stringValue((document.metadata as Record<string, unknown>).ownerId) ??
            stringValue((document.metadata as Record<string, unknown>).userId);
          if (!ownerId) continue;
          corpusRows.push(
            corpusDocumentRow(document, {
              ownerId,
              sourceType:
                table === "messages" ? "message" : table === "audio_assets" ? "audio" : "import",
              sourceId: stringValue(row.message_id) ?? stringValue(row.audio_id),
              conversationId: stringValue(row.conversation_id),
              language: stringValue(row.language),
            }),
          );
        }
        console.log(`[import] ${table}: ${hydrated.length} rows`);
      }
    }

    if (corpusRows.length > 0) {
      await database.bulkUpsert("corpus_documents", corpusRows);
      imported.set("corpus_documents", corpusRows.length);
      console.log(`[import] corpus_documents: ${corpusRows.length} indexed Filo documents`);
    }

    if (audioDrillsFlag >= 0) {
      if (ownerFlag < 0) throw new Error("--owner-id is required for audio drills");
      const root = requiredArg(
        args[audioDrillsFlag + 1],
        "--audio-drills-root requires a directory",
      );
      const ownerId = requiredArg(args[ownerFlag + 1], "--owner-id is required for audio drills");
      const count = await importAudioDrills(database, root, ownerId);
      if (count > 0) imported.set("audio_drills", count);
      console.log(`[import] audio_drills: ${count} drills plus indexed audio assets`);
    }

    for (const [table, count] of imported) {
      const sample = await database.select(table, { limit: 1 });
      if (sample.length !== 1) throw new Error(`Verification failed for ${table}`);
      console.log(`[verify] ${table}: sample readable (${count} imported)`);
    }
  } finally {
    source?.close();
    await db().close();
  }
}

async function importAudioDrills(db: Database, root: string, ownerId: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9._-]+$/u.test(entry.name)) continue;
    const dir = join(root, entry.name);
    const lesson = validFiloDocument(
      await Bun.file(join(dir, "lesson.filo.json"))
        .json()
        .catch(() => null),
    );
    if (!lesson) continue;
    const source = validFiloDocument(
      await Bun.file(join(dir, "source.filo.json"))
        .json()
        .catch(() => null),
    );
    await persistAudioDrillDirectory(db, ownerId, entry.name, dir, lesson, source);
    count++;
  }
  return count;
}

interface LegacySource {
  read(table: TableName): Promise<Record<string, unknown>[]>;
  close(): void;
}

class SqliteSource implements LegacySource {
  private readonly database: Sqlite;

  constructor(path: string) {
    this.database = new Sqlite(path, { readonly: true });
  }

  async read(table: TableName): Promise<Record<string, unknown>[]> {
    const exists = this.database
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
      .get(table);
    if (!exists) return [];
    return this.database.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  }

  close(): void {
    this.database.close();
  }
}

class SupabaseRestSource implements LegacySource {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}

  async read(table: TableName): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1_000) {
      const response = await fetch(
        `${this.url.replace(/\/$/u, "")}/rest/v1/${table}?select=*&offset=${offset}&limit=1000`,
        {
          headers: {
            apikey: this.secret,
            Authorization: `Bearer ${this.secret}`,
          },
        },
      );
      if (response.status === 404) return [];
      if (!response.ok) {
        throw new Error(
          `Supabase export failed for ${table}: ${response.status} ${await response.text()}`,
        );
      }
      const page = (await response.json()) as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < 1_000) return rows;
    }
  }

  close(): void {}
}

function hydrateLegacyRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const output = { ...row };
  for (const column of tableDefinition(table).jsonColumns ?? []) {
    const value = output[column];
    if (typeof value !== "string") continue;
    try {
      output[column] = JSON.parse(value);
    } catch {
      // Preserve malformed legacy data verbatim so the migration is lossless.
    }
  }
  for (const [column, value] of Object.entries(output)) {
    if ((column === "is_agent" || column === "correct") && typeof value === "number") {
      output[column] = value !== 0;
    }
    if (column.endsWith("_at") && typeof value === "string") {
      const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
      if (!Number.isNaN(parsed.valueOf())) output[column] = parsed.toISOString();
    }
  }
  return output;
}

function validFiloDocument(value: unknown): FiloDocumentJson | null {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as FiloDocumentJson).id !== "string" ||
    typeof (value as FiloDocumentJson).text !== "string" ||
    !Array.isArray((value as FiloDocumentJson).tiers)
  ) {
    return null;
  }
  return value as FiloDocumentJson;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredArg(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

await main();
