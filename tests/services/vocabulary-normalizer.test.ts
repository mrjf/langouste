import { afterEach, describe, expect, test } from "bun:test";
import type { Database, Filter, Scalar, SelectOptions } from "../../src/lib/db/types.ts";
import { clearDictionaryLookupCache } from "../../src/services/references/dictionary.ts";
import {
  canonicalizeVocabularyRow,
  normalizeVocabularyTerm,
} from "../../src/services/spaced-repetition/vocabulary-normalizer.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDictionaryLookupCache();
});

describe("vocabulary normalization", () => {
  test("stores capitalized headwords in normalized lemma form", async () => {
    mockWiktionary({
      Számos: null,
      számos: page("számos", "Hungarian", ["numerous, many"]),
    });

    const normalized = await normalizeVocabularyTerm("Számos", "hu");

    expect(normalized.term).toBe("számos");
    expect(normalized.source_term).toBe("számos");
    expect(normalized.definition).toBe("numerous, many");
    expect(normalized.source_url).toBe("https://en.wiktionary.org/wiki/sz%C3%A1mos#Hungarian");
    expect(normalized.target_source_url).toBe("https://hu.wiktionary.org/wiki/sz%C3%A1mos");
  });

  test("prefers the form lemma over a fallback base-source page", async () => {
    mockWiktionary({
      szétszórva: null,
      szétszór: null,
      szór: page("szór", "Hungarian", ["to scatter"]),
    });

    const normalized = await normalizeVocabularyTerm("szétszórva", "hu");

    expect(normalized.term).toBe("szétszór");
    expect(normalized.source_term).toBe("szór");
    expect(normalized.form_description).toBe("adverbial participle of szétszór");
  });

  test("keeps prefixed lemma headwords when definitions fall back to a base page", async () => {
    mockWiktionary({
      szétszór: null,
      szór: page("szór", "Hungarian", ["to scatter"]),
    });

    const normalized = await normalizeVocabularyTerm("szétszór", "hu");

    expect(normalized.term).toBe("szétszór");
    expect(normalized.source_term).toBe("szór");
    expect(normalized.form_description).toBe("prefixed verb szétszór; base szór");
    expect(normalized.definition).toBe("to scatter");
  });

  test("normalizes common Hungarian demonstrative forms to their lemma", async () => {
    mockWiktionary({
      ebben: null,
      ez: null,
    });

    const normalized = await normalizeVocabularyTerm("ebben", "hu");

    expect(normalized.term).toBe("ez");
    expect(normalized.source_term).toBe("ez");
    expect(normalized.form_description).toBe("inessive singular of ez");
    expect(normalized.definition).toBe("in this");
  });

  test("merges existing surface rows into canonical lemma rows", async () => {
    mockWiktionary({
      Számos: null,
      számos: page("számos", "Hungarian", ["numerous, many"]),
    });
    const db = new MemoryDatabase();
    db.rows.vocabulary.push(
      {
        vocab_id: "surface",
        user_id: "user-1",
        language: "hu",
        term: "Számos",
        translation: "many",
        encounters: 2,
        productions: 1,
        heard: 1,
      },
      {
        vocab_id: "lemma",
        user_id: "user-1",
        language: "hu",
        term: "számos",
        translation: "numerous",
        encounters: 3,
        productions: 0,
        heard: 4,
      },
    );
    db.rows.review_log.push({
      log_id: "log-1",
      item_type: "vocabulary",
      item_id: "surface",
    });

    const normalized = await canonicalizeVocabularyRow(db, "user-1", "hu", "Számos");

    expect(normalized.term).toBe("számos");
    expect(db.rows.vocabulary.map((row) => row.term)).toEqual(["számos"]);
    expect(db.rows.vocabulary[0].encounters).toBe(5);
    expect(db.rows.vocabulary[0].productions).toBe(1);
    expect(db.rows.vocabulary[0].heard).toBe(5);
    expect(db.rows.review_log[0].item_id).toBe("lemma");
  });
});

class MemoryDatabase implements Database {
  rows: Record<string, Record<string, unknown>[]> = {
    vocabulary: [],
    review_log: [],
  };

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    let rows = [...(this.rows[table] ?? [])];
    rows = rows.filter((row) => matches(row, options.filters ?? []));
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return rows as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const stored = { ...row };
    this.rows[table] = [...(this.rows[table] ?? []), stored];
    return stored as T;
  }

  async upsert<T>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const existing = (this.rows[table] ?? []).find((candidate) =>
      conflictColumns.every((column) => candidate[column] === row[column]),
    );
    if (existing) {
      Object.assign(existing, row);
      return existing as T;
    }
    return this.insert<T>(table, row);
  }

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    for (const row of this.rows[table] ?? []) {
      if (matches(row, filters)) Object.assign(row, patch);
    }
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    const row = (this.rows[table] ?? []).find((candidate) => matches(candidate, filters));
    if (!row) throw new Error("not found");
    Object.assign(row, patch);
    return row as T;
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    this.rows[table] = (this.rows[table] ?? []).filter((row) => !matches(row, filters));
  }

  async rpc<T>(): Promise<T> {
    throw new Error("rpc not implemented");
  }

  async raw<T>(): Promise<T[]> {
    throw new Error("raw not implemented");
  }
}

function mockWiktionary(pages: Record<string, string | null>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const title = url.searchParams.get("page") ?? "";
    const html = pages[title];
    if (!html) {
      return Response.json({ error: { code: "missingtitle" } });
    }
    return Response.json({ parse: { title, text: { "*": html } } });
  }) as typeof fetch;
}

function page(title: string, language: string, definitions: string[]): string {
  const list = definitions.map((definition) => `<li>${definition}</li>`).join("");
  return `
    <div class="mw-heading mw-heading2"><h2 id="${language}">${language}</h2></div>
    <div class="mw-heading mw-heading3"><h3 id="Verb">Verb</h3></div>
    <ol>${list}</ol>
    <div class="mw-heading mw-heading2"><h2 id="Other">Other</h2></div>
    <p>${title}</p>
  `;
}

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
