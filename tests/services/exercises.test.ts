import { describe, expect, test } from "bun:test";
import type { Database, Filter, SelectOptions } from "../../src/lib/db/types.ts";
import {
  getExerciseHistory,
  getExerciseSession,
  submitExerciseAttempt,
} from "../../src/services/exercises/generator.ts";
import {
  getExerciseProgressForTarget,
  getExerciseProgressLookup,
} from "../../src/services/profile/exercise-progress.ts";
import { recordInteraction } from "../../src/services/spaced-repetition/interactions.ts";

describe("exercise generator", () => {
  test("generates bounded CEFR-targeted translation exercises without cloze prompts", async () => {
    const db = seededDb();

    const session = await getExerciseSession(db, "user-1", "hu", 8);

    expect(session.language).toBe("hu");
    expect(session.cefrLevel).toBe("A2");
    expect(session.exercises).toHaveLength(8);
    expect(session.exercises.map((exercise) => exercise.kind)).toContain("guided_translation");
    expect(session.exercises.map((exercise) => exercise.kind)).toContain("translation_recall");
    expect(session.exercises.map((exercise) => exercise.kind)).toContain(
      "reverse_translation_choice",
    );
    expect(session.exercises.map((exercise) => exercise.kind)).toContain("spelling_recall");
    expect(session.exercises.every((exercise) => exercise.kind !== "vocabulary_cloze")).toBe(true);
    expect(session.exercises.every((exercise) => exercise.kind !== "grammar_concept_choice")).toBe(
      true,
    );
    expect(session.exercises.every((exercise) => !exercise.prompt.includes("_____"))).toBe(true);
    expect(
      session.exercises.every(
        (exercise) => !/^Which grammar focus matches\b/i.test(exercise.prompt),
      ),
    ).toBe(true);
    expect(session.exercises.every((exercise) => exercise.payload.responseMode !== "open")).toBe(
      true,
    );
    expect(session.exercises.every((exercise) => exercise.payload.templateId)).toBe(true);
    expect(
      session.exercises.every((exercise) => exercise.payload.scoringPolicy !== "record_only"),
    ).toBe(true);
    expect(session.exercises.every((exercise) => exercise.expected)).toBe(true);
    expect(session.exercises.every((exercise) => exercise.payload.eventType === "recall")).toBe(
      true,
    );
    expect(session.exercises.every((exercise) => !/^Write\b/i.test(exercise.prompt))).toBe(true);
    expect(session.exercises.every((exercise) => exercise.payload.targetInstructions)).toBe(true);
    expect(session.exercises[0].payload.targetInstructions).toBe(
      "Válaszd ki a legközelebbi fordítást.",
    );
    expect(db.rows.exercise_attempts).toHaveLength(8);

    const second = await getExerciseSession(db, "user-1", "hu", 8);
    expect(second.summary.pending).toBe(8);
    expect(second.exercises.map((exercise) => exercise.attemptId)).toEqual(
      session.exercises.map((exercise) => exercise.attemptId),
    );
  });

  test("supports deterministic lexical targeting constraints", async () => {
    const db = seededDb();

    const session = await getExerciseSession(db, "user-1", "hu", 4, {
      targetLexemes: ["kenyér"],
      exerciseKinds: ["translation_recall", "spelling_recall"],
      deterministicOnly: true,
    });

    expect(session.exercises).toHaveLength(2);
    expect(session.exercises.map((exercise) => exercise.kind)).toEqual([
      "translation_recall",
      "spelling_recall",
    ]);
    expect(session.exercises.every((exercise) => exercise.itemId === "vocab-2")).toBe(true);
    expect(session.exercises.every((exercise) => exercise.expected === "kenyér")).toBe(true);
  });

  test("records an exercise answer and SRS feedback", async () => {
    const db = seededDb();
    const session = await getExerciseSession(db, "user-1", "hu", 8);
    const recall = session.exercises.find((exercise) => exercise.kind === "translation_recall");
    expect(recall).toBeTruthy();

    const result = await submitExerciseAttempt(db, "user-1", recall!.attemptId, "szétszórva");

    expect(result.correct).toBe(true);
    expect(result.quality).toBe(5);
    expect(result.feedback).toContain("Correct");

    const attempt = db.rows.exercise_attempts.find((row) => row.attempt_id === recall!.attemptId);
    expect(attempt?.answer).toBe("szétszórva");
    expect(attempt?.correct).toBe(true);
    expect(db.rows.review_log).toHaveLength(1);
    expect(db.rows.review_log[0]).toMatchObject({
      source: "exercise",
      event_type: "recall",
      item_type: "vocabulary",
      quality: 5,
    });
    const progress = getExerciseProgressForTarget(
      await getExerciseProgressLookup(db, "user-1", "hu"),
      {
        itemType: "vocabulary",
        itemId: "vocab-1",
        conceptId: "hu:vocab:szetszorva",
      },
    );
    expect(progress).toMatchObject({
      scored_attempts: 1,
      scored_correct: 1,
      scored_partial: 0,
      scored_incorrect: 0,
      accuracy_score: 1,
      exercise_attempts: 1,
      exercise_correct: 1,
      exercise_partial: 0,
      exercise_incorrect: 0,
      exercise_score: 1,
    });
  });

  test("rolls correct, partial, and incorrect exercise outcomes into lexical progress", async () => {
    const db = seededDb();
    const session = await getExerciseSession(db, "user-1", "hu", 8);
    const wrongRecall = session.exercises.find(
      (exercise) => exercise.kind === "translation_recall" && exercise.itemId === "vocab-1",
    );
    const partialSpelling = session.exercises.find(
      (exercise) => exercise.kind === "spelling_recall" && exercise.itemId === "vocab-1",
    );
    const correctChoice = session.exercises.find(
      (exercise) => exercise.kind === "reverse_translation_choice" && exercise.itemId === "vocab-1",
    );
    expect(wrongRecall).toBeTruthy();
    expect(partialSpelling).toBeTruthy();
    expect(correctChoice).toBeTruthy();

    await submitExerciseAttempt(db, "user-1", wrongRecall!.attemptId, "rossz");
    await submitExerciseAttempt(db, "user-1", partialSpelling!.attemptId, "szetszorva");
    await submitExerciseAttempt(db, "user-1", correctChoice!.attemptId, correctChoice!.expected);

    const progress = getExerciseProgressForTarget(
      await getExerciseProgressLookup(db, "user-1", "hu"),
      {
        itemType: "vocabulary",
        itemId: "vocab-1",
        conceptId: "hu:vocab:szetszorva",
      },
    );
    expect(progress).toMatchObject({
      scored_attempts: 3,
      scored_correct: 1,
      scored_partial: 1,
      scored_incorrect: 1,
      accuracy_score: 0.5,
      exercise_attempts: 3,
      exercise_correct: 1,
      exercise_partial: 1,
      exercise_incorrect: 1,
      exercise_score: 0.5,
    });
    expect(progress.last_exercised_at).toBeTruthy();
  });

  test("rolls non-exercise review recalls into item accuracy", async () => {
    const db = seededDb();

    await recordInteraction(db, {
      userId: "user-1",
      language: "hu",
      itemType: "vocabulary",
      itemId: "vocab-2",
      eventType: "recall",
      outcome: "correct",
      quality: 5,
      source: "review",
    });
    await recordInteraction(db, {
      userId: "user-1",
      language: "hu",
      itemType: "vocabulary",
      itemId: "vocab-2",
      eventType: "recall",
      outcome: "correct",
      quality: 4,
      source: "review",
    });

    const progress = getExerciseProgressForTarget(
      await getExerciseProgressLookup(db, "user-1", "hu"),
      {
        itemType: "vocabulary",
        itemId: "vocab-2",
        conceptId: "hu:vocab:kenyer",
      },
    );
    expect(progress).toMatchObject({
      scored_attempts: 2,
      scored_correct: 2,
      scored_partial: 0,
      scored_incorrect: 0,
      accuracy_score: 1,
      exercise_attempts: 0,
      exercise_correct: 0,
    });
    expect(progress.last_scored_at).toBeTruthy();
    expect(progress.last_exercised_at).toBeNull();
  });

  test("records an exact choice click as correct", async () => {
    const db = seededDb();
    const session = await getExerciseSession(db, "user-1", "hu", 8);
    const choice = session.exercises.find(
      (exercise) => exercise.kind === "reverse_translation_choice",
    );
    expect(choice).toBeTruthy();

    const result = await submitExerciseAttempt(db, "user-1", choice!.attemptId, choice!.expected);

    expect(result.correct).toBe(true);
    expect(result.outcome).toBe("correct");
    expect(result.feedback).toContain("Correct");
    const attempt = db.rows.exercise_attempts.find((row) => row.attempt_id === choice!.attemptId);
    expect(attempt).toMatchObject({
      answer: choice!.expected,
      correct: true,
      quality: 5,
    });
  });

  test("allows a stale client to repair a wrong choice attempt with the correct option", async () => {
    const db = seededDb();
    const session = await getExerciseSession(db, "user-1", "hu", 8);
    const choice = session.exercises.find(
      (exercise) => exercise.kind === "reverse_translation_choice",
    );
    expect(choice).toBeTruthy();
    const wrongOption = choice!.payload.options?.find((option) => option !== choice!.expected);
    expect(wrongOption).toBeTruthy();

    const first = await submitExerciseAttempt(db, "user-1", choice!.attemptId, wrongOption);
    expect(first.correct).toBe(false);

    const repaired = await submitExerciseAttempt(db, "user-1", choice!.attemptId, choice!.expected);

    expect(repaired.correct).toBe(true);
    expect(repaired.outcome).toBe("correct");
    expect(repaired.feedback).toContain("Correct");
    const attempt = db.rows.exercise_attempts.find((row) => row.attempt_id === choice!.attemptId);
    expect(attempt).toMatchObject({
      answer: choice!.expected,
      correct: true,
      quality: 5,
    });
    expect(db.rows.review_log).toHaveLength(2);
    expect(db.rows.review_log.map((row) => row.quality)).toEqual([1, 5]);
  });

  test("records CEFR translation prompts as recall", async () => {
    const db = seededDb();
    const session = await getExerciseSession(db, "user-1", "hu", 8);
    const translation = session.exercises.find(
      (exercise) => exercise.kind === "guided_translation",
    );
    expect(translation).toBeTruthy();

    const result = await submitExerciseAttempt(
      db,
      "user-1",
      translation!.attemptId,
      translation!.expected,
    );

    expect(result.correct).toBe(true);
    expect(result.outcome).toBe("correct");
    expect(result.quality).toBe(5);
    expect(db.rows.review_log).toHaveLength(1);
    expect(db.rows.review_log[0]).toMatchObject({
      source: "exercise",
      event_type: "recall",
      item_type: "grammar",
      quality: 5,
    });
    const grammarRow = db.rows.grammar_gaps.find(
      (row) => row.concept_id === translation!.conceptId,
    );
    expect(grammarRow).toBeTruthy();
    const progress = getExerciseProgressForTarget(
      await getExerciseProgressLookup(db, "user-1", "hu"),
      {
        itemType: "grammar",
        itemId: grammarRow!.gap_id as string,
        conceptId: translation!.conceptId,
      },
    );
    expect(progress).toMatchObject({
      scored_attempts: 1,
      scored_correct: 1,
      scored_partial: 0,
      scored_incorrect: 0,
      accuracy_score: 1,
      exercise_attempts: 1,
      exercise_correct: 1,
      exercise_partial: 0,
      exercise_incorrect: 0,
      exercise_score: 1,
    });
    const conceptProgress = getExerciseProgressForTarget(
      await getExerciseProgressLookup(db, "user-1", "hu"),
      {
        itemType: "grammar",
        conceptId: translation!.conceptId,
      },
    );
    expect(conceptProgress.exercise_correct).toBe(1);
  });

  test("does not reuse pending open-ended sentence attempts", async () => {
    const db = seededDb();
    db.rows.exercise_attempts.push({
      attempt_id: "legacy-open",
      user_id: "user-1",
      language: "hu",
      exercise_id: "old-open",
      item_type: "vocabulary",
      item_id: "vocab-1",
      concept_id: "hu:vocab:szetszorva",
      kind: "use_target_word",
      prompt: "Write one Hungarian sentence using this word or phrase: szétszórva",
      instructions: "Use the item naturally in a complete sentence.",
      expected: null,
      answer: null,
      correct: null,
      quality: null,
      feedback: null,
      payload: {
        kind: "use_target_word",
        itemType: "vocabulary",
        responseMode: "open",
        eventType: "production",
        lookupKey: "szétszórva",
        label: "szétszórva",
        expected: null,
        alternatives: [],
        reason: "Due CEFR-matched vocabulary",
      },
      created_at: new Date().toISOString(),
      answered_at: null,
    });

    const session = await getExerciseSession(db, "user-1", "hu", 1);

    expect(session.summary.pending).toBe(0);
    expect(session.summary.new).toBe(1);
    expect(session.exercises[0].attemptId).not.toBe("legacy-open");
    expect(session.exercises[0].payload.responseMode).not.toBe("open");
    expect(session.exercises[0].expected).toBeTruthy();
  });

  test("does not reuse pending legacy cloze attempts", async () => {
    const db = seededDb();
    db.rows.exercise_attempts.push({
      attempt_id: "legacy-cloze",
      user_id: "user-1",
      language: "hu",
      exercise_id: "old-cloze",
      item_type: "vocabulary",
      item_id: "vocab-1",
      concept_id: "hu:vocab:szetszorva",
      kind: "vocabulary_cloze",
      prompt: "_____ README található szétszórva ebben a könyvtárban.",
      instructions: "Fill in the missing target-language word or phrase.",
      expected: "szétszórva",
      answer: null,
      correct: null,
      quality: null,
      feedback: null,
      payload: {
        kind: "vocabulary_cloze",
        itemType: "vocabulary",
        lookupKey: "szétszórva",
        label: "szétszórva",
        expected: "szétszórva",
        alternatives: ["szétszórva"],
        reason: "Due vocabulary review",
      },
      created_at: new Date().toISOString(),
      answered_at: null,
    });

    const session = await getExerciseSession(db, "user-1", "hu", 1);

    expect(session.summary.pending).toBe(0);
    expect(session.summary.new).toBe(1);
    expect(session.exercises[0].attemptId).not.toBe("legacy-cloze");
    expect(session.exercises[0].kind).not.toBe("vocabulary_cloze");
    expect(session.exercises[0].prompt).not.toContain("_____");
  });

  test("does not reuse pending legacy grammar focus choice attempts", async () => {
    const db = seededDb();
    db.rows.exercise_attempts.push({
      attempt_id: "legacy-grammar-choice",
      user_id: "user-1",
      language: "hu",
      exercise_id: "old-grammar-choice",
      item_type: "grammar",
      item_id: "gap-legacy",
      concept_id: "cefr:hu:A1:translation:study-every-day",
      kind: "grammar_concept_choice",
      prompt: "Which grammar focus matches this Hungarian issue: Basic daily routine",
      instructions: "Choose the grammar category this practice should target.",
      expected: "Cefr Hu A1 Translation Study Every Day",
      answer: null,
      correct: null,
      quality: null,
      feedback: null,
      payload: {
        kind: "grammar_concept_choice",
        itemType: "grammar",
        responseMode: "choice",
        eventType: "recall",
        lookupKey: "cefr:hu:A1:translation:study-every-day",
        label: "Cefr Hu A1 Translation Study Every Day",
        expected: "Cefr Hu A1 Translation Study Every Day",
        alternatives: ["Cefr Hu A1 Translation Study Every Day"],
        options: [
          "Formal vs. informal address.",
          "Adjective position.",
          "Cefr Hu A1 Translation Study Every Day",
          "Noun: Gender.",
        ],
        reason: "Legacy grammar choice",
      },
      created_at: new Date().toISOString(),
      answered_at: null,
    });

    const session = await getExerciseSession(db, "user-1", "hu", 1);

    expect(session.summary.pending).toBe(0);
    expect(session.summary.new).toBe(1);
    expect(session.exercises[0].attemptId).not.toBe("legacy-grammar-choice");
    expect(session.exercises[0].kind).not.toBe("grammar_concept_choice");
    expect(session.exercises[0].prompt).not.toMatch(/^Which grammar focus matches\b/i);

    const history = await getExerciseHistory(db, "user-1", "hu", 8);
    expect(history.map((attempt) => attempt.attemptId)).not.toContain("legacy-grammar-choice");
    expect(history.every((attempt) => attempt.kind !== "grammar_concept_choice")).toBe(true);
  });

  test("does not reuse pending self-rating instruction attempts", async () => {
    const db = seededDb();
    db.rows.exercise_attempts.push({
      attempt_id: "legacy-rating",
      user_id: "user-1",
      language: "hu",
      exercise_id: "old-rating",
      item_type: "vocabulary",
      item_id: "vocab-1",
      concept_id: "hu:vocab:szetszorva",
      kind: "use_target_word",
      prompt: "Write one Hungarian sentence using this word or phrase: szétszórva",
      instructions:
        "Use the item naturally in a complete sentence, then rate how well you used it.",
      expected: null,
      answer: null,
      correct: null,
      quality: null,
      feedback: null,
      payload: {
        kind: "use_target_word",
        itemType: "vocabulary",
        responseMode: "self_rated",
        eventType: "production",
        lookupKey: "szétszórva",
        label: "szétszórva",
        expected: null,
        alternatives: [],
        reason: "Due CEFR-matched vocabulary",
      },
      created_at: new Date().toISOString(),
      answered_at: null,
    });

    const session = await getExerciseSession(db, "user-1", "hu", 1);

    expect(session.summary.pending).toBe(0);
    expect(session.summary.new).toBe(1);
    expect(session.exercises[0].attemptId).not.toBe("legacy-rating");
    expect(session.exercises[0].instructions).not.toMatch(/self[- ]?rat|rate how well/i);
  });
});

class MemoryDatabase implements Database {
  rows: Record<string, Record<string, unknown>[]>;
  private id = 0;

  constructor(rows: Record<string, Record<string, unknown>[]>) {
    this.rows = rows;
  }

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    let rows = [...(this.rows[table] ?? [])];
    rows = rows.filter((row) => matches(row, options.filters ?? []));
    for (const order of [...(options.order ?? [])].reverse()) {
      rows.sort((left, right) => {
        const leftValue = String(left[order.column] ?? "");
        const rightValue = String(right[order.column] ?? "");
        return (order.ascending === false ? -1 : 1) * leftValue.localeCompare(rightValue);
      });
    }
    if (options.limit != null) rows = rows.slice(0, options.limit);
    return rows as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    return (await this.select<T>(table, { ...options, limit: 1 }))[0] ?? null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const stored = { ...row };
    const idColumn = idColumnFor(table);
    if (idColumn && !stored[idColumn]) stored[idColumn] = `${table}-${++this.id}`;
    if (table === "exercise_attempts" && !stored.created_at) {
      stored.created_at = new Date().toISOString();
    }
    if (table === "review_log" && !stored.observed_at) {
      stored.observed_at = new Date().toISOString();
    }
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

function seededDb(): MemoryDatabase {
  return new MemoryDatabase({
    profiles: [
      {
        user_id: "user-1",
        learning_languages: [{ lang: "hu", cefr_level: "A2", assessed_at: "" }],
      },
    ],
    vocabulary: [
      {
        vocab_id: "vocab-1",
        user_id: "user-1",
        language: "hu",
        term: "szétszórva",
        translation: "scattered",
        context_sentence: "Számos README található szétszórva ebben a könyvtárban.",
        cefr_level: "A2",
        concept_id: "hu:vocab:szetszorva",
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        encounters: 2,
        productions: 0,
        correct_productions: 0,
        self_corrected_productions: 0,
        heard: 0,
        spoken: 0,
        next_review_at: "2020-01-01T00:00:00.000Z",
        last_reviewed_at: null,
        last_heard_at: null,
        last_spoken_at: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        vocab_id: "vocab-2",
        user_id: "user-1",
        language: "hu",
        term: "kenyér",
        translation: "bread",
        context_sentence: "Kérek egy kenyeret.",
        cefr_level: "A1",
        concept_id: "hu:vocab:kenyer",
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 2,
        encounters: 2,
        productions: 1,
        correct_productions: 1,
        self_corrected_productions: 0,
        heard: 0,
        spoken: 0,
        next_review_at: "2027-01-01T00:00:00.000Z",
        last_reviewed_at: null,
        last_heard_at: null,
        last_spoken_at: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    grammar_gaps: [
      {
        gap_id: "gap-1",
        user_id: "user-1",
        language: "hu",
        category: "u:syntax:word-order.verb",
        description: "Verb position in clauses.",
        concept_id: "hu:grammar:verb-order",
        error_count: 2,
        last_error_at: "2020-01-01T00:00:00.000Z",
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        encounters: 0,
        productions: 0,
        correct_productions: 0,
        self_corrected_productions: 0,
        next_review_at: "2020-01-01T00:00:00.000Z",
        last_reviewed_at: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    concept_srs: [
      {
        concept_state_id: "concept-1",
        user_id: "user-1",
        language: "hu",
        concept_id: "hu:vocab:szetszorva",
        item_type: "vocabulary",
        label: "szétszórva",
        difficulty: 0,
        stability: 0,
        retrievability: 1,
        interval_days: 0,
        repetitions: 0,
        lapses: 0,
        next_review_at: "2020-01-01T00:00:00.000Z",
        last_reviewed_at: null,
      },
      {
        concept_state_id: "concept-2",
        user_id: "user-1",
        language: "hu",
        concept_id: "hu:grammar:verb-order",
        item_type: "grammar",
        label: "Verb order",
        difficulty: 0,
        stability: 0,
        retrievability: 1,
        interval_days: 0,
        repetitions: 0,
        lapses: 0,
        next_review_at: "2020-01-01T00:00:00.000Z",
        last_reviewed_at: null,
      },
    ],
    fsrs_configs: [],
    review_log: [],
    exercise_attempts: [],
  });
}

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "lte") return String(row[filter.column] ?? "") <= String(filter.value ?? "");
    if (filter.op === "lt") return String(row[filter.column] ?? "") < String(filter.value ?? "");
    if (filter.op === "in") return filter.values.includes(row[filter.column] as string);
    return true;
  });
}

function idColumnFor(table: string): string | null {
  if (table === "exercise_attempts") return "attempt_id";
  if (table === "review_log") return "log_id";
  if (table === "concept_srs") return "concept_state_id";
  if (table === "vocabulary") return "vocab_id";
  if (table === "grammar_gaps") return "gap_id";
  return null;
}
