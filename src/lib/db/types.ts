/**
 * Small query-builder surface implemented by turbopuffer.
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

export interface FullTextField {
  column: string;
  weight?: number;
}

export interface FullTextSearchOptions {
  fields: FullTextField[];
  filters?: Filter[];
  limit?: number;
  /** Materialized attributes to return. Omit to reconstruct the complete row. */
  columns?: string;
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

  /** Bulk upsert complete rows during migrations/backfills. */
  bulkUpsert?(table: string, rows: Record<string, unknown>[]): Promise<void>;

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

  /** Run BM25 over one or more full-text-enabled attributes. */
  fullTextSearch?<T = Record<string, unknown>>(
    table: string,
    query: string,
    options: FullTextSearchOptions,
  ): Promise<T[]>;

  /** Test-only destructive reset. Implementations must reject it in production. */
  clear?(table: string): Promise<void>;
}

/**
 * The app validates JWTs before handing a database handle to a request.
 * turbopuffer has no built-in row-level security, so service-layer ownership
 * and membership filters remain mandatory.
 */
export interface DatabaseSet {
  admin: Database;
  forUser(accessToken: string): Database;
  /** Close any open connections. Used by tests and shutdown. */
  close(): Promise<void>;
}
