import { describe, expect, test } from "bun:test";
import type { Database, Filter, Scalar, SelectOptions } from "../../src/lib/db/types.ts";
import { upsertFSRSConfig } from "../../src/services/spaced-repetition/config.ts";
import { DEFAULT_FSRS_PARAMETERS } from "../../src/services/spaced-repetition/fsrs.ts";
import { recordInteraction } from "../../src/services/spaced-repetition/interactions.ts";
import { trackLearningProgress } from "../../src/services/spaced-repetition/tracker.ts";

class MemoryDatabase implements Database {
  rows: Record<string, Record<string, unknown>[]> = {
    vocabulary: [],
    grammar_gaps: [],
    concept_srs: [],
    fsrs_configs: [],
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
    if (table === "concept_srs") {
      const conflict = this.rows.concept_srs.find(
        (existing) =>
          existing.user_id === row.user_id &&
          existing.language === row.language &&
          existing.concept_id === row.concept_id,
      );
      if (conflict) throw new Error("unique constraint");
    }
    const stored = {
      ...defaults(table),
      ...row,
      [idColumn(table)]: `${table}-${this.rows[table].length + 1}`,
    };
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

  async update(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<void> {
    for (const row of this.rows[table] ?? []) {
      if (matches(row, filters)) Object.assign(row, patch);
    }
  }

  async updateOne<T>(table: string, patch: Record<string, unknown>, filters: Filter[]): Promise<T> {
    const row = this.rows[table].find((candidate) => matches(candidate, filters));
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

describe("recordInteraction", () => {
  test("serializes concurrent events for the same new item", async () => {
    const db = new MemoryDatabase();

    await Promise.all([
      recordInteraction(db, {
        userId: "user-1",
        language: "fr",
        itemType: "vocabulary",
        lookupKey: "chat",
        seed: { translation: "cat" },
        eventType: "production",
        outcome: "correct",
        source: "chat_produce",
      }),
      recordInteraction(db, {
        userId: "user-1",
        language: "fr",
        itemType: "vocabulary",
        lookupKey: "chat",
        seed: { translation: "cat" },
        eventType: "encounter",
        source: "chat_encounter",
      }),
    ]);

    expect(db.rows.vocabulary).toHaveLength(1);
    expect(db.rows.vocabulary[0]).toMatchObject({
      term: "chat",
      productions: 1,
      correct_productions: 1,
      encounters: 1,
    });
    expect(db.rows.review_log).toHaveLength(2);
  });

  test("schedules atomic concepts instead of per-card state", async () => {
    const db = new MemoryDatabase();
    const conceptId = "fr:concept:article-gender";

    await recordInteraction(db, {
      userId: "user-1",
      language: "fr",
      itemType: "vocabulary",
      lookupKey: "chat",
      seed: { translation: "cat", concept_id: conceptId },
      eventType: "production",
      outcome: "correct",
      source: "chat_produce",
    });
    await recordInteraction(db, {
      userId: "user-1",
      language: "fr",
      itemType: "grammar",
      lookupKey: "article gender",
      seed: { description: "Article gender agreement", concept_id: conceptId },
      eventType: "production",
      outcome: "incorrect",
      source: "chat_self_correct",
    });

    expect(db.rows.concept_srs).toHaveLength(1);
    expect(db.rows.concept_srs[0].concept_id).toBe(conceptId);
    expect(db.rows.concept_srs[0].lapses).toBe(1);
    expect(db.rows.vocabulary[0].concept_id).toBe(conceptId);
    expect(db.rows.grammar_gaps[0].concept_id).toBe(conceptId);
    expect(db.rows.review_log.map((row) => row.concept_id)).toEqual([conceptId, conceptId]);
  });

  test("uses tunable FSRS parameters and interaction quality weights", async () => {
    const db = new MemoryDatabase();
    const tunedParameters = [...DEFAULT_FSRS_PARAMETERS];
    tunedParameters[3] = 20;

    await upsertFSRSConfig(db, "user-1", "fr", {
      parameters: tunedParameters,
      quality_weights: { "production:correct": 5 },
    });

    await recordInteraction(db, {
      userId: "user-1",
      language: "fr",
      itemType: "vocabulary",
      lookupKey: "bonjour",
      seed: { translation: "hello", concept_id: "fr:word:bonjour" },
      eventType: "production",
      outcome: "correct",
      source: "chat_produce",
    });

    expect(db.rows.concept_srs[0].stability).toBe(20);
    expect((db.rows.review_log[0].after_state as any).fsrs_config.parameters[3]).toBe(20);
  });

  test("tracks heard and spoken vocabulary without scheduling recall", async () => {
    const db = new MemoryDatabase();

    await recordInteraction(db, {
      userId: "user-1",
      language: "hu",
      itemType: "vocabulary",
      lookupKey: "szétszór",
      eventType: "heard",
      source: "dictionary_audio",
    });
    await recordInteraction(db, {
      userId: "user-1",
      language: "hu",
      itemType: "vocabulary",
      lookupKey: "szétszór",
      eventType: "spoken",
      source: "exercise",
    });

    expect(db.rows.vocabulary[0].heard).toBe(1);
    expect(db.rows.vocabulary[0].spoken).toBe(1);
    expect(db.rows.vocabulary[0].repetitions).toBe(0);
    expect(db.rows.review_log.map((row) => row.event_type)).toEqual(["heard", "spoken"]);
    expect(db.rows.review_log.map((row) => row.quality)).toEqual([null, null]);
  });

  test("does not invent grammar gaps outside the closed ontology", async () => {
    const db = new MemoryDatabase();

    await trackLearningProgress(db, "user-1", "hu", {
      new_vocabulary: [],
      grammar_gaps_detected: [
        {
          category: "general:no_target_language_produced",
          description: "No recognizable Hungarian target-language output.",
        },
        {
          category: "general:communication",
          description: "Random keystrokes without communication.",
        },
        {
          category: "articles:definite_vs_indefinite",
          description: "The learner used 'egy' where 'a' would be more natural for a known item.",
        },
      ],
      next_challenge: "",
    });

    expect(db.rows.grammar_gaps.map((row) => row.category)).toEqual([
      "u:syntax:determiner.definiteness",
    ]);
    expect(db.rows.grammar_gaps[0].description).toBe("Definite vs. indefinite article usage.");
    expect((db.rows.review_log[0].after_state as any).evidence.commentary).toContain(
      "The learner used 'egy'",
    );
    expect(db.rows.review_log).toHaveLength(1);
  });

  test("does not create self-correction fallback grammar categories", async () => {
    const db = new MemoryDatabase();

    await trackLearningProgress(
      db,
      "user-1",
      "hu",
      { new_vocabulary: [], grammar_gaps_detected: [], next_challenge: "" },
      "message-1",
      [
        {
          original: "asdf",
          corrected: "jó napot",
          kind: "grammar",
          explanation: "The original text was not a sentence.",
        },
      ],
    );

    expect(db.rows.grammar_gaps).toHaveLength(0);
    expect(db.rows.review_log).toHaveLength(0);
  });

  test("keeps universal and language-specific syntax categories distinct", async () => {
    const db = new MemoryDatabase();
    const input = {
      new_vocabulary: [],
      grammar_gaps_detected: [
        { category: "word_order:question_formation", description: "Question word order." },
        { category: "prepositions:à_vs_de", description: "Used à where de is required." },
      ],
      next_challenge: "",
    };

    await trackLearningProgress(db, "user-1", "fr", input);
    await trackLearningProgress(db, "user-1", "hu", input);

    expect(db.rows.grammar_gaps.map((row) => `${row.language}:${row.category}`)).toEqual([
      "fr:u:syntax:word-order.question",
      "fr:fr:syntax:preposition.a-vs-de",
      "hu:u:syntax:word-order.question",
    ]);
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

function idColumn(table: string): string {
  if (table === "vocabulary") return "vocab_id";
  if (table === "grammar_gaps") return "gap_id";
  if (table === "concept_srs") return "concept_state_id";
  if (table === "fsrs_configs") return "config_id";
  return "log_id";
}

function defaults(table: string): Record<string, unknown> {
  if (table === "vocabulary" || table === "grammar_gaps") {
    return {
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      encounters: 0,
      productions: 0,
      correct_productions: 0,
      self_corrected_productions: 0,
      heard: 0,
      spoken: 0,
      next_review_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    };
  }
  if (table === "concept_srs") {
    return {
      difficulty: 0,
      stability: 0,
      retrievability: 1,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      next_review_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      last_reviewed_at: null,
    };
  }
  if (table === "fsrs_configs") {
    return {
      parameters: [...DEFAULT_FSRS_PARAMETERS],
      request_retention: 0.9,
      maximum_interval_days: 36500,
      failure_review_delay_minutes: 10,
      quality_weights: {},
    };
  }
  return {};
}
