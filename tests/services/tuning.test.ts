import { describe, expect, test } from "bun:test";
import type { Database, Filter, Scalar, SelectOptions } from "../../src/lib/db/types.ts";
import { tuneFSRSInteractionWeights } from "../../src/services/spaced-repetition/tuning.ts";

class MemoryDatabase implements Database {
  rows: Record<string, Record<string, unknown>[]> = {
    fsrs_configs: [],
    review_log: [],
  };

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    let rows = [...(this.rows[table] ?? [])];
    rows = rows.filter((row) => matches(row, options.filters ?? []));
    if (options.order?.length) {
      rows.sort((a, b) => {
        for (const order of options.order ?? []) {
          const left = String(a[order.column] ?? "");
          const right = String(b[order.column] ?? "");
          const comparison = left.localeCompare(right);
          if (comparison !== 0) return order.ascending === false ? -comparison : comparison;
        }
        return 0;
      });
    }
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return rows as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const stored = { ...row, config_id: `${table}-${this.rows[table].length + 1}` };
    this.rows[table].push(stored);
    return stored as T;
  }

  async upsert<T>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const existing = this.rows[table].find((candidate) =>
      conflictColumns.every((column) => candidate[column] === row[column]),
    );
    if (existing) {
      Object.assign(existing, row);
      return existing as T;
    }
    return this.insert<T>(table, row);
  }

  async update(): Promise<void> {}
  async updateOne<T>(): Promise<T> {
    throw new Error("not implemented");
  }
  async delete(): Promise<void> {}
  async rpc<T>(): Promise<T> {
    throw new Error("not implemented");
  }
  async raw<T>(): Promise<T[]> {
    throw new Error("not implemented");
  }
}

describe("tuneFSRSInteractionWeights", () => {
  test("derives signal quality from later recall outcomes", async () => {
    const db = new MemoryDatabase();
    for (let index = 0; index < 6; index++) {
      const conceptId = `fr:word:${index}`;
      db.rows.review_log.push(
        {
          user_id: "user-1",
          language: "fr",
          concept_id: conceptId,
          event_type: "production",
          outcome: "correct",
          quality: 4,
          source: "exercise",
          observed_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        },
        {
          user_id: "user-1",
          language: "fr",
          concept_id: conceptId,
          event_type: "recall",
          outcome: "correct",
          quality: 5,
          source: "review",
          observed_at: `2026-01-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`,
        },
      );
    }

    const dryRun = await tuneFSRSInteractionWeights(db, "user-1", "fr", {
      minEvidence: 3,
      dryRun: true,
    });
    expect(dryRun.applied).toBe(false);
    expect(dryRun.suggestions[0]).toMatchObject({
      key: "exercise:production:correct",
      suggested_quality: 5,
    });

    const applied = await tuneFSRSInteractionWeights(db, "user-1", "fr", {
      minEvidence: 3,
      dryRun: false,
    });
    expect(applied.applied).toBe(true);
    expect(applied.config.quality_weights["exercise:production:correct"]).toBe(5);
  });
});

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    switch (filter.op) {
      case "eq":
        return row[filter.column] === filter.value;
      case "lt":
        return (row[filter.column] as Scalar) < filter.value;
      case "lte":
        return (row[filter.column] as Scalar) <= filter.value;
      case "in":
        return filter.values.includes(row[filter.column] as Scalar);
      default:
        return false;
    }
  });
}
