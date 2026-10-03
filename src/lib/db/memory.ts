import type {
  Database,
  DatabaseSet,
  Filter,
  FullTextSearchOptions,
  SelectOptions,
} from "./types.ts";
import { applyTableDefaults, tableDefinition, withoutUndefined } from "./table-schema.ts";

/** Ephemeral test double. It is never selectable in a production config. */
class MemoryDatabase implements Database {
  private readonly tables = new Map<string, Record<string, unknown>[]>();

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    tableDefinition(table);
    let rows = [...(this.tables.get(table) ?? [])].filter((row) =>
      (options.filters ?? []).every((filter) => matches(row, filter)),
    );
    if (options.order) rows.sort((left, right) => compareRows(left, right, options.order!));
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return rows.map((row) => project(row, options.columns)) as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, input: Record<string, unknown>): Promise<T> {
    const definition = tableDefinition(table);
    const row = applyTableDefaults(table, input);
    for (const columns of [definition.idColumns, ...(definition.unique ?? [])]) {
      if ((this.tables.get(table) ?? []).some((other) => sameOn(other, row, columns))) {
        throw new Error(`Unique constraint failed: ${table}(${columns.join(", ")})`);
      }
    }
    this.table(table).push(structuredClone(row));
    return structuredClone(row) as T;
  }

  async upsert<T>(
    table: string,
    input: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const rows = this.table(table);
    const index = rows.findIndex((row) => sameOn(row, input, conflictColumns));
    if (index < 0) return this.insert<T>(table, input);
    rows[index] = { ...rows[index], ...withoutUndefined(input) };
    return structuredClone(rows[index]) as T;
  }

  async bulkUpsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const definition = tableDefinition(table);
    for (const input of rows) {
      const existing = this.table(table).find((row) =>
        definition.idColumns.every((column) => row[column] === input[column]),
      );
      if (existing) {
        Object.assign(existing, withoutUndefined(input));
      } else {
        this.table(table).push(applyTableDefaults(table, structuredClone(input)));
      }
    }
  }

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    const rows = this.table(table);
    for (let index = 0; index < rows.length; index++) {
      if (filters.every((filter) => matches(rows[index], filter))) {
        rows[index] = { ...rows[index], ...withoutUndefined(patch) };
      }
    }
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    const rows = this.table(table);
    const index = rows.findIndex((row) => filters.every((filter) => matches(row, filter)));
    if (index < 0) throw new Error(`updateOne matched no rows in ${table}`);
    rows[index] = { ...rows[index], ...withoutUndefined(patch) };
    return structuredClone(rows[index]) as T;
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    this.tables.set(
      table,
      this.table(table).filter((row) => !filters.every((filter) => matches(row, filter))),
    );
  }

  async fullTextSearch<T>(
    table: string,
    query: string,
    options: FullTextSearchOptions,
  ): Promise<T[]> {
    const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const rows = await this.select<Record<string, unknown>>(table, { filters: options.filters });
    return rows
      .map((row) => {
        const search_score = options.fields.reduce((score, field) => {
          const text = String(row[field.column] ?? "").toLocaleLowerCase();
          return score + terms.filter((term) => text.includes(term)).length * (field.weight ?? 1);
        }, 0);
        return { ...row, search_score };
      })
      .filter((row) => row.search_score > 0)
      .sort((left, right) => right.search_score - left.search_score)
      .slice(0, options.limit ?? 20)
      .map((row) =>
        options.columns
          ? { ...project(row, options.columns), search_score: row.search_score }
          : row,
      ) as T[];
  }

  async clear(table: string): Promise<void> {
    tableDefinition(table);
    this.tables.set(table, []);
  }

  private table(table: string): Record<string, unknown>[] {
    tableDefinition(table);
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }
}

export function createMemoryDatabaseSet(): DatabaseSet {
  const database = new MemoryDatabase();
  return {
    admin: database,
    forUser: () => database,
    async close() {},
  };
}

function matches(row: Record<string, unknown>, filter: Filter): boolean {
  const value = row[filter.column] as string | number | boolean | null;
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "lt":
      return value != null && filter.value != null && value < filter.value;
    case "lte":
      return value != null && filter.value != null && value <= filter.value;
    case "in":
      return filter.values.includes(value);
  }
}

function sameOn(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  columns: string[],
): boolean {
  return columns.every((column) => left[column] === right[column]);
}

function compareRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  order: NonNullable<SelectOptions["order"]>,
): number {
  for (const item of order) {
    const a = left[item.column] as string | number | boolean | null | undefined;
    const b = right[item.column] as string | number | boolean | null | undefined;
    if (a === b) continue;
    const result = a == null ? -1 : b == null ? 1 : a < b ? -1 : 1;
    return item.ascending === false ? -result : result;
  }
  return 0;
}

function project(row: Record<string, unknown>, columns?: string): Record<string, unknown> {
  const clone = structuredClone(row);
  if (!columns || columns.trim() === "*") return clone;
  const names = columns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return Object.fromEntries(names.map((column) => [column, clone[column]]));
}
