/**
 * Small query-builder surface shared by both the Supabase and SQLite backends.
 *
 * Each method is async because the Supabase impl always is; the SQLite impl
 * runs synchronously under the hood but wraps in a resolved promise for parity.
 *
 * We intentionally keep the surface narrow: only the operations used today by
 * src/services/database/*.ts. Growing it is cheap; shrinking it is painful.
 */

export type Scalar = string | number | boolean | null;

export type Filter =
  | { op: "eq"; column: string; value: Scalar }
  | { op: "lt"; column: string; value: Scalar }
  | { op: "lte"; column: string; value: Scalar }
  | { op: "in"; column: string; values: Scalar[] };

export interface OrderBy {
  column: string;
  ascending?: boolean; // default true
}

export interface SelectOptions {
  columns?: string; // default "*"
  filters?: Filter[];
  order?: OrderBy[];
  limit?: number;
}

export interface Database {
  /** Return up to `limit` rows matching the filters, optionally ordered. */
  select<T = Record<string, unknown>>(table: string, options?: SelectOptions): Promise<T[]>;

  /**
   * Return a single row or null. If multiple rows match, the result is
   * implementation-defined — callers must use filters that uniquely identify.
   */
  selectOne<T = Record<string, unknown>>(table: string, options?: SelectOptions): Promise<T | null>;

  /** Insert a row. Returns the inserted row as stored. */
  insert<T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T>;

  /** Insert-or-update on conflict with the given column list. Returns the row. */
  upsert<T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T>;

  /** Update matching rows with the given patch. Does not return rows. */
  update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void>;

  /** Update matching rows and return a single row. Errors if zero match. */
  updateOne<T = Record<string, unknown>>(
    table: string,
    patch: Record<string, unknown>,
    filters: Filter[],
  ): Promise<T>;

  /** Delete matching rows. */
  delete(table: string, filters: Filter[]): Promise<void>;

  /**
   * Call a stored procedure / RPC. The Supabase impl calls `rpc(name, args)`;
   * the SQLite impl dispatches to an in-process function registry (see
   * lib/db/rpc.ts).
   */
  rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;

  /**
   * Execute raw SQL with positional parameters. The caller is responsible for
   * dialect compatibility — use sparingly, prefer the structured methods.
   */
  raw<T = Record<string, unknown>>(sql: string, params?: Scalar[]): Promise<T[]>;
}

/**
 * Both backends expose two clients: an "admin" one that bypasses RLS and a
 * per-request one scoped to a user's JWT. In SQLite mode there is no RLS and
 * both clients are the same instance.
 */
export interface DatabaseSet {
  admin: Database;
  forUser(accessToken: string): Database;
  /** Close any open connections. Used by tests and shutdown. */
  close(): Promise<void>;
}
