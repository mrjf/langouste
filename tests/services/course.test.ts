import { describe, expect, test } from "bun:test";
import { createMemoryDatabaseSet } from "../../src/lib/db/memory.ts";
import {
  loadCourseCatalog,
  publicCourseLesson,
  validateCourseBundle,
} from "../../src/services/course/catalog.ts";
import { actOnCourse, normalizeCourseAnswer } from "../../src/services/course/progress.ts";
import { getCourseProgress, listCourseProgress } from "../../src/services/database/course.ts";

const lessons = await loadCourseCatalog();
const hu = lessons.find((l) => l.language === "hu")!;
const ar = lessons.find((l) => l.language === "ar-EG")!;
const recall = hu.exercises.find((e) => e.type === "recall" && e.trackInSrs !== false)!;
const answer = {
  type: "answer" as const,
  exerciseId: recall.id,
  answer: recall.acceptedAnswers[0],
  attemptId: "one",
};

describe("source-grounded course", () => {
  test("feedback explanation may be empty, but must remain a string", async () => {
    const bundle = await Bun.file("content/ai-course/authored-course.json").json();
    bundle.lessons[0].exercises[0].explanation = "";
    expect(() => validateCourseBundle(bundle)).not.toThrow();
    bundle.lessons[0].exercises[0].explanation = null;
    expect(() => validateCourseBundle(bundle)).toThrow("Invalid exercise");
  });
  test("installs both languages; public questions do not expose answer-bearing authored metadata", () => {
    expect(hu.exercises.length).toBeGreaterThanOrEqual(18);
    expect(ar.exercises.length).toBeGreaterThanOrEqual(16);
    for (const l of lessons)
      for (const e of publicCourseLesson(l).exercises) {
        expect(e).not.toHaveProperty("acceptedAnswers");
        expect(e).not.toHaveProperty("originalExercise");
        expect(e).not.toHaveProperty("choiceAtoms");
        if (!e.showChoiceEnglish)
          for (const support of Object.values(e.choiceSupport ?? {}))
            expect(support).not.toHaveProperty("english");
      }
    expect(() =>
      validateCourseBundle({ schemaVersion: 1, sourceRegistry: [], lessons: [hu] }),
    ).toThrow();
  });
  test("loading content creates no evidence; ownership and language remain isolated", async () => {
    const { admin: db } = createMemoryDatabaseSet();
    expect(await getCourseProgress(db, "a", hu.id)).toBeNull();
    await actOnCourse(db, "a", hu, { type: "navigate", step: "practice" });
    expect(await getCourseProgress(db, "b", hu.id)).toBeNull();
    expect(await getCourseProgress(db, "a", ar.id)).toBeNull();
    expect(await db.select("review_log")).toHaveLength(0);
    expect((await listCourseProgress(db, "a"))[0].step).toBe("practice");
  });
  test("concurrent duplicate submissions and later retries score only once, with resumable server state", async () => {
    const { admin: db } = createMemoryDatabaseSet();
    const results = await Promise.all([
      actOnCourse(db, "a", hu, answer),
      actOnCourse(db, "a", hu, answer),
    ]);
    expect(results.every((r) => r.feedback?.correct && r.feedback.scored)).toBe(true);
    const saved = await getCourseProgress(db, "a", hu.id);
    expect(saved?.exercises[recall.id].attempts).toHaveLength(1);
    expect(
      (await db.select<{ event_type: string }>("review_log")).filter(
        (r) => r.event_type === "recall",
      ),
    ).toHaveLength(1);
    await actOnCourse(db, "a", hu, { ...answer, attemptId: "two" });
    expect((await getCourseProgress(db, "a", hu.id))?.exercises[recall.id].attempts[1].scored).toBe(
      false,
    );
    expect(
      (await db.select<{ event_type: string }>("review_log")).filter(
        (r) => r.event_type === "recall",
      ),
    ).toHaveLength(1);
    await expect(actOnCourse(db, "a", hu, { ...answer, answer: "changed" })).rejects.toThrow(
      "Attempt ID",
    );
  });
  test("hint, reveal, recognition and self-check never create recall credit", async () => {
    for (const type of ["hint", "reveal"] as const) {
      const { admin: db } = createMemoryDatabaseSet();
      await actOnCourse(db, "a", hu, { type, exerciseId: recall.id });
      expect((await actOnCourse(db, "a", hu, answer)).feedback?.scored).toBe(false);
      expect(
        (await db.select<{ event_type: string }>("review_log")).filter(
          (r) => r.event_type === "recall",
        ),
      ).toHaveLength(0);
    }
    const { admin: db } = createMemoryDatabaseSet();
    for (const type of ["choice", "self-check"] as const) {
      const e = hu.exercises.find((e) => e.type === type)!;
      const r = await actOnCourse(db, "a", hu, {
        type: "answer",
        exerciseId: e.id,
        answer: e.acceptedAnswers[0],
        attemptId: type,
      });
      expect(r.feedback?.scored).toBe(false);
      if (type === "self-check") expect(r.feedback?.correct).toBeNull();
    }
    expect(
      (await db.select<{ event_type: string }>("review_log")).filter(
        (r) => r.event_type === "recall",
      ),
    ).toHaveLength(0);
  });
  test("completion requires readings and attempts and never asserts mastery", async () => {
    const { admin: db } = createMemoryDatabaseSet();
    await expect(actOnCourse(db, "a", hu, { type: "complete" })).rejects.toThrow();
    await expect(
      actOnCourse(db, "a", hu, { type: "read", sectionId: "invented" }),
    ).rejects.toThrow();
    for (const r of hu.readings) await actOnCourse(db, "a", hu, { type: "read", sectionId: r.id });
    for (const e of hu.exercises)
      await actOnCourse(db, "a", hu, {
        type: "answer",
        exerciseId: e.id,
        answer: e.acceptedAnswers[0],
        attemptId: e.id,
      });
    const r = await actOnCourse(db, "a", hu, { type: "complete" });
    expect(r.progress.completed_at).toBeTruthy();
    expect(r.progress).not.toHaveProperty("mastery");
  });
  test("Hungarian accents remain meaningful and optional Arabic vowel marks do not fail", () => {
    expect(normalizeCourseAnswer(" ÚJ! ", "hu")).toBe("új");
    expect(normalizeCourseAnswer("uj", "hu")).not.toBe("új");
    expect(normalizeCourseAnswer("جَدِيد؟", "ar-EG")).toBe("جديد");
  });
});

test("partial SRS failure preserves the attempt and never blindly repeats its effect", async () => {
  const { admin: real } = createMemoryDatabaseSet();
  let fail = true;
  const db = new Proxy(real, {
    get(target, key) {
      if (key === "insert")
        return async (table: string, row: Record<string, unknown>) => {
          if (table === "review_log" && fail) {
            fail = false;
            throw new Error("simulated interruption after SRS write");
          }
          return target.insert(table, row);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await actOnCourse(db, "crash-user", hu, answer);
  expect(result.progress.exercises[recall.id].attempts).toHaveLength(1);
  expect(result.progress.sync_receipts?.[0].status).toBe("uncertain");
  expect(result.feedback?.scored).toBe(false);
  const before = await real.select("concept_srs");
  await actOnCourse(db, "crash-user", hu, answer);
  expect(await real.select("concept_srs")).toEqual(before);
  expect(await real.select("review_log")).toHaveLength(0);
});

test("a rejected progress write prevents any SRS effect", async () => {
  const { admin: real } = createMemoryDatabaseSet();
  const db = new Proxy(real, {
    get(target, key) {
      if (key === "upsert")
        return async (table: string, row: Record<string, unknown>, columns: string[]) => {
          if (table === "course_progress") throw new Error("progress unavailable");
          return target.upsert(table, row, columns);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(actOnCourse(db, "a", hu, answer)).rejects.toThrow("progress unavailable");
  expect(await real.select("review_log")).toHaveLength(0);
  expect(await real.select("concept_srs")).toHaveLength(0);
});

test("one lexical identity can retain separate sense-level FSRS evidence", async () => {
  const { admin: db } = createMemoryDatabaseSet();
  for (const sense of ["later", "then"]) {
    const lesson = structuredClone(hu);
    lesson.id += `-${sense}`;
    const word = lesson.vocabulary.find((v) => v.id === recall.target.id)!;
    word.semanticConcept = sense;
    const exercise = lesson.exercises.find((e) => e.id === recall.id)!;
    exercise.target.semanticConcept = sense;
    await actOnCourse(db, "sense-user", lesson, answer);
    const saved = await getCourseProgress(db, "sense-user", lesson.id);
    expect(saved?.exercises[exercise.id].attempts[0].semanticConcept).toBe(sense);
  }
  const concepts = await db.select<{ concept_id: string; repetitions: number }>("concept_srs");
  expect(concepts).toHaveLength(2);
  expect(concepts.every((c) => c.repetitions === 1)).toBe(true);
  expect(concepts.map((c) => c.concept_id).sort()).toEqual([
    `course:hu:${recall.target.id}:sense:later`,
    `course:hu:${recall.target.id}:sense:then`,
  ]);
  expect(await db.select("vocabulary")).toHaveLength(1);
});

test("the complete course resolves registries and preserves all 1080 authored exercise identities", () => {
  const original = lessons.filter((l) => l.day <= 30);
  expect(original).toHaveLength(60);
  expect(original.reduce((n, l) => n + l.exercises.length, 0)).toBe(1080);
  for (const language of ["hu", "ar-EG"])
    expect(original.filter((l) => l.language === language).map((l) => l.day)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  expect(hu.readings[0].sentences[0].kind).toBe("source-summary");
  for (const lesson of lessons) {
    expect(lesson.sources.length).toBeGreaterThan(0);
    for (const e of publicCourseLesson(lesson).exercises) {
      expect(e).not.toHaveProperty("answerData");
      expect(e).not.toHaveProperty("modelAnswer");
      expect(e.promptAtom).not.toHaveProperty("english");
      for (const pair of e.matchingPairs ?? []) expect(pair).not.toHaveProperty("answer");
    }
  }
});

test("matching stores per-pair evidence and self-assessment stays unverified", async () => {
  const { admin: db } = createMemoryDatabaseSet();
  const e = ar.exercises.find((e) => e.type === "matching")!;
  const submitted = JSON.parse(e.acceptedAnswers[0]);
  submitted["0"] = "wrong";
  await expect(
    actOnCourse(db, "a", ar, {
      type: "answer",
      exerciseId: e.id,
      attemptId: "invalid",
      answer: JSON.stringify(submitted),
    }),
  ).rejects.toThrow();
  submitted["0"] = e.choices!.find((c) => c !== e.matchingPairs![0].answer)!;
  const result = await actOnCourse(db, "a", ar, {
    type: "answer",
    exerciseId: e.id,
    attemptId: "match",
    answer: JSON.stringify(submitted),
    transliterationVisible: true,
  });
  const attempt = result.progress.exercises[e.id].attempts[0];
  expect(attempt.pairResults?.[0].correct).toBe(false);
  expect(attempt.pairResults?.slice(1).every((p) => p.correct)).toBe(true);
  expect(attempt.scored).toBe(false);
  expect(attempt.transliterationVisible).toBe(true);
  const open = hu.exercises.find((e) => e.type === "self-check")!;
  await actOnCourse(db, "a", hu, {
    type: "answer",
    exerciseId: open.id,
    attemptId: "open",
    answer: "A valid alternative",
  });
  const assessed = await actOnCourse(db, "a", hu, {
    type: "self-assess",
    exerciseId: open.id,
    assessment: "met",
  });
  expect(assessed.progress.exercises[open.id].attempts[0]).toMatchObject({
    selfAssessment: "met",
    correct: null,
    scored: false,
  });
});
