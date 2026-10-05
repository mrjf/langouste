import { createHash } from "node:crypto";
import {
  Turbopuffer,
  type AttributeSchema,
  type Row as TurbopufferRow,
} from "@turbopuffer/turbopuffer";

import type {
  Database,
  DatabaseSet,
  Filter,
  FullTextSearchOptions,
  Scalar,
  SelectOptions,
} from "./types.ts";
import {
  FLOAT_COLUMNS,
  QUERYABLE_COLUMNS,
  applyTableDefaults,
  tableDefinition,
  withoutUndefined,
} from "./table-schema.ts";

const PAYLOAD_PREFIX = "_payload_";
// Leave headroom below tpuf's 8 MiB per-attribute and 64 MiB per-document
// limits for attribute names, searchable projections, and request framing.
const MAX_PAYLOAD_CHUNK_BYTES = 7 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 60 * 1024 * 1024;
const DEFAULT_QUERY_LIMIT = 10_000;
const WRITE_BATCH_SIZE = 500;

type RankBy = unknown;
type TpufFilter = unknown;

export class TurbopufferDatabase implements Database {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: Turbopuffer,
    private readonly prefix: string,
    private readonly testMode = false,
  ) {}

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    tableDefinition(table);
    if (options.filters?.some((filter) => filter.op === "in" && filter.values.length === 0)) {
      return [];
    }
    const filters = toTpufFilters(options.filters ?? []);
    const rankBy: RankBy = options.order?.[0]
      ? [options.order[0].column, options.order[0].ascending === false ? "desc" : "asc"]
      : ["id", "asc"];

    try {
      const result = await this.namespace(table).query({
        filters: filters as never,
        rank_by: rankBy as never,
        limit: Math.min(Math.max(options.limit ?? DEFAULT_QUERY_LIMIT, 1), DEFAULT_QUERY_LIMIT),
        include_attributes: true,
      });
      const rows = (result.rows ?? []).map(decodeRow);
      if (options.order && options.order.length > 1) sortRows(rows, options.order);
      return rows.map((row) => projectRow(row, options.columns)) as T[];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw contextualError("select", table, error);
    }
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, input: Record<string, unknown>): Promise<T> {
    return this.serialized(async () => {
      const row = applyTableDefaults(table, input);
      await this.assertUnique(table, row);
      await this.writeRows(table, [row]);
      return row as T;
    });
  }

  async upsert<T>(
    table: string,
    input: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    return this.serialized(async () => {
      const existing = await this.selectOne<Record<string, unknown>>(table, {
        filters: conflictColumns.map((column) => ({
          op: "eq" as const,
          column,
          value: scalar(input[column]),
        })),
      });
      const definition = tableDefinition(table);
      const identity = existing
        ? Object.fromEntries(definition.idColumns.map((column) => [column, existing[column]]))
        : {};
      const row = existing
        ? { ...existing, ...withoutUndefined(input), ...identity }
        : applyTableDefaults(table, input);
      await this.writeRows(table, [row]);
      return row as T;
    });
  }

  async bulkUpsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    await this.serialized(() =>
      this.writeRows(
        table,
        rows.map((row) => applyTableDefaults(table, row)),
      ),
    );
  }

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    await this.serialized(async () => {
      const rows = await this.select<Record<string, unknown>>(table, { filters });
      if (rows.length === 0) return;
      await this.writeRows(
        table,
        rows.map((row) => ({ ...row, ...withoutUndefined(patch) })),
      );
    });
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    return this.serialized(async () => {
      const row = await this.selectOne<Record<string, unknown>>(table, { filters });
      if (!row) throw new Error(`updateOne matched no rows in ${table}`);
      const updated = { ...row, ...withoutUndefined(patch) };
      await this.writeRows(table, [updated]);
      return updated as T;
    });
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    await this.serialized(async () => {
      const definition = tableDefinition(table);
      const rows = await this.select<Record<string, unknown>>(table, { filters });
      const ids = rows.map((row) => documentId(definition.idColumns, row));
      for (let offset = 0; offset < ids.length; offset += WRITE_BATCH_SIZE) {
        await this.namespace(table).write({
          deletes: ids.slice(offset, offset + WRITE_BATCH_SIZE),
        });
      }
    });
  }

  async fullTextSearch<T>(
    table: string,
    query: string,
    options: FullTextSearchOptions,
  ): Promise<T[]> {
    const definition = tableDefinition(table);
    const enabled = new Set(definition.fullTextColumns ?? []);
    if (!query.trim()) return [];
    if (options.fields.length === 0) throw new Error("fullTextSearch requires at least one field");
    for (const field of options.fields) {
      if (!enabled.has(field.column)) {
        throw new Error(`${table}.${field.column} is not configured for full-text search`);
      }
    }
    const clauses = options.fields.map((field) => {
      const clause = [field.column, "BM25", query.trim()];
      return field.weight && field.weight !== 1 ? ["Product", field.weight, clause] : clause;
    });
    const rankBy = clauses.length === 1 ? clauses[0] : ["Sum", clauses];

    try {
      const result = await this.namespace(table).query({
        filters: toTpufFilters(options.filters ?? []) as never,
        rank_by: rankBy as never,
        limit: Math.min(options.limit ?? 20, 100),
        include_attributes: options.columns ? parseColumns(options.columns) : true,
      });
      return (result.rows ?? []).map((row) => {
        const decoded = options.columns ? decodeProjection(row) : decodeRow(row);
        if (typeof row.$dist === "number") decoded.search_score = row.$dist;
        return decoded as T;
      });
    } catch (error) {
      if (isNotFound(error)) return [];
      throw contextualError("full-text search", table, error);
    }
  }

  async clear(table: string): Promise<void> {
    tableDefinition(table);
    if (!this.testMode) throw new Error("Database.clear() is only available in test mode");
    await this.serialized(async () => {
      try {
        await this.namespace(table).deleteAll();
      } catch (error) {
        if (!isNotFound(error)) throw contextualError("clear", table, error);
      }
    });
  }

  async writeRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const definition = tableDefinition(table);
    for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + WRITE_BATCH_SIZE);
      const encoded = batch.map((row) => encodeRow(table, definition.idColumns, row));
      const schema = mergeSchema(encoded.map((item) => item.schema));
      try {
        await this.namespace(table).write({
          upsert_rows: encoded.map((item) => item.row),
          schema,
        });
      } catch (error) {
        throw contextualError("write", table, error);
      }
    }
  }

  private namespace(table: string) {
    return this.client.namespace(namespaceName(table, this.prefix));
  }

  private async assertUnique(table: string, row: Record<string, unknown>): Promise<void> {
    const definition = tableDefinition(table);
    for (const columns of [definition.idColumns, ...(definition.unique ?? [])]) {
      const existing = await this.selectOne(table, {
        filters: columns.map((column) => ({
          op: "eq",
          column,
          value: scalar(row[column]),
        })),
      });
      if (existing) throw new Error(`Unique constraint failed: ${table}(${columns.join(", ")})`);
    }
  }

  /**
   * The application currently runs as one Bun process. Serialize read-modify-
   * write mutations so concurrent enrichment patches cannot clobber unrelated
   * JSON fields in the same logical row.
   */
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release = () => {};
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export interface TurbopufferOptions {
  apiKey: string;
  region: string;
  namespacePrefix: string;
  baseURL?: string;
  testMode?: boolean;
  compression?: boolean;
  maxRetries?: number;
}
export function createTurbopufferDatabaseSet(options: TurbopufferOptions): DatabaseSet {
  if (!/^[A-Za-z0-9-_.]{1,96}$/.test(options.namespacePrefix))
    throw new Error("Invalid namespace prefix");
  const client = new Turbopuffer({
    apiKey: options.apiKey,
    region: options.baseURL && !options.baseURL.includes("{region}") ? null : options.region,
    baseURL: options.baseURL || undefined,
    compression: options.compression ?? true,
    maxRetries: options.maxRetries,
  });
  const database = new TurbopufferDatabase(client, options.namespacePrefix, options.testMode);
  return { admin: database, forUser: () => database, async close() {} };
}
export function namespaceName(table: string, prefix: string): string {
  return `${prefix}-${table.replaceAll("_", "-")}`;
}

function encodeRow(
  table: string,
  idColumns: string[],
  input: Record<string, unknown>,
): { row: TurbopufferRow; schema: Record<string, AttributeSchema> } {
  const row = withoutUndefined(input);
  const id = documentId(idColumns, row);
  const encoded: TurbopufferRow = { id };
  const schema: Record<string, AttributeSchema> = {};
  const fullTextColumns = new Set(tableDefinition(table).fullTextColumns ?? []);
  const projectedColumns = new Set(tableDefinition(table).projectedColumns ?? []);
  const jsonColumns = new Set(tableDefinition(table).jsonColumns ?? []);

  for (const [column, value] of Object.entries(row)) {
    if (jsonColumns.has(column)) continue;
    if (
      !QUERYABLE_COLUMNS.has(column) &&
      !fullTextColumns.has(column) &&
      !projectedColumns.has(column)
    ) {
      continue;
    }
    if (!isMaterializable(value)) continue;
    encoded[column] = value;
    schema[column] = attributeSchema(column, value, fullTextColumns.has(column));
  }
  for (const column of fullTextColumns) {
    if (schema[column]) continue;
    encoded[column] = null;
    schema[column] = {
      type: "string",
      filterable: QUERYABLE_COLUMNS.has(column),
      full_text_search: true,
    };
  }

  const payload = JSON.stringify(row);
  const chunks = splitUtf8(payload, MAX_PAYLOAD_CHUNK_BYTES);
  const estimatedBytes =
    Buffer.byteLength(payload, "utf8") +
    Object.entries(encoded).reduce(
      (total, [column, value]) =>
        total +
        Buffer.byteLength(column, "utf8") +
        Buffer.byteLength(JSON.stringify(value), "utf8"),
      0,
    );
  if (estimatedBytes > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${table} row ${id} exceeds the 60 MiB turbopuffer document budget; ` +
        "store the binary/source object in an external blob store and retain its URI",
    );
  }
  chunks.forEach((chunk, index) => {
    const column = `${PAYLOAD_PREFIX}${index.toString().padStart(2, "0")}`;
    encoded[column] = chunk;
    schema[column] = { type: "string", filterable: false };
  });
  return { row: encoded, schema };
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maxBytes);
    let bytes = Buffer.byteLength(value.slice(start, end), "utf8");
    while (bytes > maxBytes) {
      const width = Math.max(1, Math.floor(((end - start) * maxBytes) / bytes));
      end = start + width;
      bytes = Buffer.byteLength(value.slice(start, end), "utf8");
    }
    // Keep surrogate pairs together so each chunk is valid Unicode on its own.
    if (
      end < value.length &&
      end > start &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 &&
      value.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

function decodeRow(row: TurbopufferRow): Record<string, unknown> {
  const payload = Object.entries(row)
    .filter(([column]) => column.startsWith(PAYLOAD_PREFIX))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => String(value))
    .join("");
  if (!payload) throw new Error(`turbopuffer row ${row.id} is missing its JSON payload`);
  return JSON.parse(payload) as Record<string, unknown>;
}

function decodeProjection(row: TurbopufferRow): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([column]) => column !== "id" && column !== "$dist" && !column.startsWith(PAYLOAD_PREFIX),
    ),
  );
}

function documentId(idColumns: string[], row: Record<string, unknown>): string {
  const parts = idColumns.map((column) => {
    const value = row[column];
    if (value == null || value === "") throw new Error(`Missing primary key column: ${column}`);
    return String(value);
  });
  const natural = parts.join(":");
  if (Buffer.byteLength(natural, "utf8") <= 64) return natural;
  return createHash("sha256").update(natural).digest("hex");
}

function attributeSchema(
  column: string,
  value: Scalar | Scalar[],
  fullText: boolean,
): AttributeSchema {
  let type: string;
  if (Array.isArray(value)) {
    const sample = value.find((item) => item != null);
    type = `[]${primitiveType(column, sample ?? "")}`;
  } else {
    type = primitiveType(column, value);
  }
  return {
    type,
    filterable: QUERYABLE_COLUMNS.has(column),
    ...(fullText ? { full_text_search: true } : {}),
  };
}

function primitiveType(column: string, value: Scalar): string {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") {
    return FLOAT_COLUMNS.has(column) || !Number.isInteger(value) ? "float" : "int";
  }
  if (column.endsWith("_at")) return "datetime";
  return "string";
}

function isMaterializable(value: unknown): value is Scalar | Scalar[] {
  if (value === null) return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return (
    Array.isArray(value) &&
    value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
  );
}

function mergeSchema(
  schemas: Array<Record<string, AttributeSchema>>,
): Record<string, AttributeSchema> {
  return Object.assign({}, ...schemas);
}

function toTpufFilters(filters: Filter[]): TpufFilter | undefined {
  if (filters.length === 0) return undefined;
  const mapped = filters.map((filter) => {
    switch (filter.op) {
      case "eq":
        return [filter.column, "Eq", filter.value];
      case "lt":
        return [filter.column, "Lt", filter.value];
      case "lte":
        return [filter.column, "Lte", filter.value];
      case "in":
        return [filter.column, "In", filter.values];
      default:
        throw new Error(`Unsupported filter: ${JSON.stringify(filter)}`);
    }
  });
  return mapped.length === 1 ? mapped[0] : ["And", mapped];
}

function scalar(value: unknown): Scalar {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value as Scalar;
  }
  throw new Error(`Expected scalar conflict/filter value, received ${typeof value}`);
}

function projectRow(
  row: Record<string, unknown>,
  columns: string | undefined,
): Record<string, unknown> {
  if (!columns || columns.trim() === "*") return row;
  if (columns.includes("(")) {
    throw new Error("Nested relational selects are not supported by the turbopuffer adapter");
  }
  const names = columns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return Object.fromEntries(names.map((column) => [column, row[column]]));
}

function parseColumns(columns: string): string[] {
  if (columns.includes("(")) {
    throw new Error("Nested relational selects are not supported by the turbopuffer adapter");
  }
  return columns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function sortRows(rows: Record<string, unknown>[], order: NonNullable<SelectOptions["order"]>) {
  rows.sort((left, right) => {
    for (const item of order) {
      const a = left[item.column];
      const b = right[item.column];
      if (a === b) continue;
      const result = a == null ? -1 : b == null ? 1 : a < b ? -1 : 1;
      return item.ascending === false ? -result : result;
    }
    return 0;
  });
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Turbopuffer.NotFoundError ||
    (typeof error === "object" && error !== null && "status" in error && error.status === 404)
  );
}

function contextualError(operation: string, table: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`turbopuffer ${operation} failed for ${table}: ${detail}`, {
    cause: error,
  });
}
