/**
 * Apply Langouste database migrations.
 *
 * Mode is selected by DATABASE_MODE in .env (default "supabase").
 *
 *   supabase  — runs incremental migrations from supabase/migrations/*.sql
 *               against the remote Supabase project via the Management API.
 *               Requires Supabase CLI login (token in macOS keychain).
 *
 *   sqlite    — applies sqlite/schema.sql to the local SQLite database.
 *               CREATE TABLE IF NOT EXISTS statements make it idempotent.
 *
 * Usage:
 *   bun scripts/migrate.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");

// --- Load .env ---
const envText = readFileSync(resolve(projectDir, ".env"), "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  // Also populate process.env so lib/data-dir.ts sees any LANGOUSTE_DATA_DIR.
  if (!process.env[trimmed.slice(0, eq)]) {
    process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const mode = (process.env.DATABASE_MODE ?? env.DATABASE_MODE ?? "supabase") as
  | "supabase"
  | "sqlite";

if (mode === "sqlite") {
  await runSqliteMigrations();
} else {
  await runSupabaseMigrations();
}

// ---------- SQLite path ----------
async function runSqliteMigrations() {
  const { Database } = await import("bun:sqlite");
  const { dataPath } = await import("../src/lib/data-dir.ts");

  const schemaPath = resolve(projectDir, "sqlite/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const dbPath = dataPath("langouste.db");
  console.log(`Applying SQLite schema to ${dbPath}`);

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schema);
  db.close();

  console.log("OK — SQLite schema applied.");
}

// ---------- Supabase path (original behaviour) ----------
async function runSupabaseMigrations() {
  const supabaseUrl = env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error("Missing SUPABASE_URL in .env");
    process.exit(1);
  }

  const projectRef = supabaseUrl.replace("https://", "").replace(".supabase.co", "");

  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    console.error("Could not find Supabase access token. Run: npx supabase login");
    process.exit(1);
  }

  const API_BASE = "https://api.supabase.com/v1";

  async function runSQL(sql: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SQL query failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  try {
    console.log(`Running migrations against project: ${projectRef}\n`);
    await runSQL(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );`,
    );

    const appliedRows = (await runSQL("SELECT name FROM _migrations ORDER BY name")) as Array<{
      name: string;
    }>;
    const applied = new Set(appliedRows.map((r) => r.name));

    const migrationsDir = resolve(projectDir, "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  Skip ${file} (already applied)`);
        continue;
      }
      console.log(`  Applying ${file}...`);
      const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
      await runSQL(sql);
      await runSQL(`INSERT INTO _migrations (name) VALUES ('${file.replace(/'/g, "''")}')`);
      console.log(`  OK`);
      count++;
    }

    console.log(count > 0 ? `\nApplied ${count} migration(s).` : "\nNo new migrations.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

function getSupabaseAccessToken(): string {
  const raw = execSync('security find-generic-password -s "Supabase CLI" -a "access-token" -w', {
    encoding: "utf-8",
  }).trim();
  if (raw.startsWith("go-keyring-base64:")) {
    const b64 = raw.replace("go-keyring-base64:", "");
    return Buffer.from(b64, "base64").toString("utf-8");
  }
  return raw;
}
