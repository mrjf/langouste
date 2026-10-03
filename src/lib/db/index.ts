/**
 * Boot-time entry point for the turbopuffer database layer. Tests may opt into
 * an ephemeral contract double; production always uses turbopuffer.
 */

import { config } from "../config.ts";
import { createMemoryDatabaseSet } from "./memory.ts";
import { createTurbopufferDatabaseSet } from "./turbopuffer.ts";
import type { Database, DatabaseSet } from "./types.ts";

export type {
  Database,
  DatabaseSet,
  Filter,
  FullTextField,
  FullTextSearchOptions,
  SelectOptions,
} from "./types.ts";

let _set: DatabaseSet | null = null;

export function db(): DatabaseSet {
  if (!_set) {
    _set =
      config.testStorage === "memory" ? createMemoryDatabaseSet() : createTurbopufferDatabaseSet();
    console.log(
      `[db] initialised with ${
        config.testStorage === "memory" ? "in-memory test transport" : "turbopuffer"
      }`,
    );
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
