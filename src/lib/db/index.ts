/**
 * Boot-time entry point for the database layer. Inspects config to pick either
 * the Supabase-backed or SQLite-backed DatabaseSet, and exposes it as a
 * process-wide singleton.
 */

import { config } from "../config.ts";
import { createSupabaseDatabaseSet } from "./supabase.ts";
import { createSqliteDatabaseSet } from "./sqlite.ts";
import "./rpc.ts"; // side-effect: registers SQLite RPC handlers
import type { Database, DatabaseSet } from "./types.ts";

export type { Database, DatabaseSet, Filter, SelectOptions } from "./types.ts";

let _set: DatabaseSet | null = null;

export function db(): DatabaseSet {
  if (!_set) {
    _set = config.databaseMode === "sqlite"
      ? createSqliteDatabaseSet()
      : createSupabaseDatabaseSet();
    console.log(`[db] initialised in ${config.databaseMode} mode`);
  }
  return _set;
}

/** Shortcut for the admin Database. Use sparingly — prefer per-request. */
export function adminDb(): Database {
  return db().admin;
}

/** Per-request Database scoped to a user's JWT. */
export function userDb(accessToken: string): Database {
  return db().forUser(accessToken);
}
