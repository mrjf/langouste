import type { Database } from "../../lib/db/index.ts";
import type {
  CourseAction,
  CourseActionResult,
  CourseLesson,
} from "../../types/course.ts";
import { getCourseProgress, saveCourseProgress } from "../database/course.ts";
import { recordInteraction, type InteractionInput } from "../spaced-repetition/interactions.ts";

import { courseExerciseFeedback, emptyCourseProgress, normalizeCourseAnswer } from "./state.ts";
export { courseExerciseFeedback, emptyCourseProgress, normalizeCourseAnswer } from "./state.ts";
const queues = new Map<string, Promise<void>>();
export async function actOnCourse(
  db: Database,
  userId: string,
  lesson: CourseLesson,
  action: CourseAction,
): Promise<CourseActionResult> {
  const key = `${userId}\0${lesson.id}`;
  const previous = queues.get(key) ?? Promise.resolve();
  let release = () => {};
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(key, turn);
  await previous;
  try {
    return await actLocked(db, userId, lesson, action);
  } finally {
    release();
    if (queues.get(key) === turn) queues.delete(key);
  }
}
async function actLocked(
  db: Database,
  userId: string,
  lesson: CourseLesson,
  action: CourseAction,
): Promise<CourseActionResult> {
  const progress = (await getCourseProgress(db, userId, lesson.id)) ?? emptyCourseProgress(lesson);
  let feedback: CourseActionResult["feedback"];
  const effects: { input: InteractionInput; targetId: string }[] = [];
  let scoreAttempt: { exerciseId: string; attemptId: string } | undefined;
  async function encounter(type: "vocabulary" | "grammar", targetId: string) {
    const target =
      type === "vocabulary"
        ? lesson.vocabulary.find((v) => v.id === targetId)
        : lesson.concepts.find((v) => v.id === targetId);
    if (!target) throw new Error("Unknown learning target");
    const key = `${type}:${targetId}`;
    if (progress.encounters.includes(key)) return;
    await recordTarget(type, targetId, "encounter");
    progress.encounters.push(key);
  }
  async function recordTarget(
    type: "vocabulary" | "grammar",
    targetId: string,
    eventType: "encounter" | "recall",
    correct?: boolean,
    semanticConcept?: string,
  ) {
    const vocab = lesson.vocabulary.find((v) => v.id === targetId);
    const grammar = lesson.concepts.find((v) => v.id === targetId);
    if ((type === "vocabulary" && !vocab) || (type === "grammar" && !grammar))
      throw new Error("Unknown learning target");
    if ((type === "vocabulary" ? vocab : grammar)?.trackInSrs === false) return;
    effects.push({
      targetId,
      input: {
        userId,
        language: lesson.language,
        itemType: type,
        lookupKey: type === "vocabulary" ? (vocab!.lexicalTerm ?? vocab!.term) : grammar!.id,
        seed:
          type === "vocabulary"
            ? {
                translation: vocab!.english,
                context_sentence: vocab!.example.text,
                cefr_level: "A1",
                concept_id: `course:${lesson.language}:${targetId}${semanticConcept || vocab!.semanticConcept ? `:sense:${encodeURIComponent(semanticConcept || vocab!.semanticConcept!)}` : ""}`,
              }
            : {
                description: grammar!.explanation,
                concept_id: `course:${lesson.language}:${targetId}`,
              },
        eventType,
        source: eventType === "recall" ? "exercise" : "reading_vocabulary",
        ...(eventType === "recall"
          ? {
              outcome: correct ? ("correct" as const) : ("incorrect" as const),
              quality: correct ? 4 : 1,
            }
          : {}),
      },
    });
  }
  if (action.type === "read") {
    if (!lesson.readings.some((r) => r.id === action.sectionId))
      throw new Error("Unknown reading section");
    if (!progress.read_sections.includes(action.sectionId))
      progress.read_sections.push(action.sectionId);
    progress.reading_evidence ??= [];
    if (!progress.reading_evidence.some((r) => r.sectionId === action.sectionId))
      progress.reading_evidence.push({
        sectionId: action.sectionId,
        englishVisible: action.englishVisible === true,
        transliterationVisible: action.transliterationVisible === true,
        at: new Date().toISOString(),
      });
  } else if (action.type === "encounter") {
    await encounter(action.itemType, action.targetId);
  } else if (action.type === "navigate") {
    if (!["read", "words", "grammar", "practice"].includes(action.step))
      throw new Error("Invalid step");
    progress.step = action.step;
  } else if (action.type === "complete") {
    if (
      progress.read_sections.length < lesson.readings.length ||
      lesson.exercises.some((e) => !progress.exercises[e.id]?.attempts.length)
    )
      throw new Error("Read each section and attempt each exercise before completing this lesson");
    progress.completed_at ??= new Date().toISOString();
  } else {
    const exercise = lesson.exercises.find((e) => e.id === action.exerciseId);
    if (!exercise) throw new Error("Unknown exercise");
    progress.exercises[exercise.id] ??= {
      hinted: false,
      revealed: false,
      attempts: [],
    };
    const state = progress.exercises[exercise.id];
    if (action.type === "self-assess") {
      if (
        exercise.type !== "self-check" ||
        !["again", "close", "met"].includes(action.assessment) ||
        !state.attempts.length
      )
        throw new Error("Attempt this self-check before assessing it");
      state.attempts.at(-1)!.selfAssessment = action.assessment;
      feedback = { ...courseExerciseFeedback(exercise), scored: false };
    } else if (action.type === "hint") {
      state.hinted = true;
      feedback = { text: exercise.hint };
    } else if (action.type === "reveal") {
      state.revealed = true;
      await encounter(exercise.target.type, exercise.target.id);
      feedback = {
        ...courseExerciseFeedback(exercise),
      };
    } else if (action.type === "answer") {
      if (
        !action.attemptId ||
        action.attemptId.length > 100 ||
        typeof action.answer !== "string" ||
        !action.answer.trim() ||
        action.answer.length > 2000
      )
        throw new Error("A bounded, non-empty answer and attempt ID are required");
      const duplicate = state.attempts.find((a) => a.id === action.attemptId);
      if (duplicate && duplicate.answer !== action.answer)
        throw new Error("Attempt ID already used for another answer");
      let pairResults: NonNullable<(typeof state.attempts)[number]["pairResults"]> | undefined;
      if (exercise.type === "matching") {
        let submitted: Record<string, string>;
        try {
          submitted = JSON.parse(action.answer);
        } catch {
          throw new Error("Match each item before checking");
        }
        if (
          !submitted ||
          typeof submitted !== "object" ||
          exercise.matchingPairs?.some((p) => !exercise.choices?.includes(submitted[p.id]))
        )
          throw new Error("Match each item before checking");
        pairResults = exercise.matchingPairs?.map((p) => ({
          id: p.id,
          targetId: p.target?.id,
          semanticConcept: p.target?.semanticConcept,
          correct: submitted[p.id] === p.answer,
        }));
      }
      const correct = duplicate
        ? duplicate.correct
        : exercise.type === "self-check"
          ? null
          : pairResults
            ? pairResults.every((p) => p.correct)
            : exercise.acceptedAnswers.some(
                (a) =>
                  normalizeCourseAnswer(a, lesson.language) ===
                  normalizeCourseAnswer(action.answer, lesson.language),
              );
      const scored =
        duplicate?.scored ??
        (exercise.type === "recall" &&
          exercise.trackInSrs !== false &&
          !state.hinted &&
          !state.revealed &&
          state.attempts.length === 0);
      if (!duplicate) {
        if (state.attempts.length >= 100)
          throw new Error("Practice attempt limit reached; continue in spaced review");
        if (scored)
          await recordTarget(
            exercise.target.type,
            exercise.target.id,
            "recall",
            correct === true,
            exercise.target.semanticConcept,
          );
        else if (exercise.type === "matching") {
          for (const pair of exercise.matchingPairs ?? [])
            if (pair.target) await encounter(pair.target.type, pair.target.id);
        } else await encounter(exercise.target.type, exercise.target.id);
        state.attempts.push({
          id: action.attemptId,
          pairResults,
          transliterationVisible: action.transliterationVisible === true,
          responseMode: /[\u0600-\u06ff]/u.test(action.answer)
            ? "arabic-script"
            : /[a-zA-Z]/u.test(action.answer)
              ? "latin"
              : "other",
          targetId: exercise.target.id,
          semanticConcept:
            exercise.target.semanticConcept ??
            lesson.vocabulary.find((v) => v.id === exercise.target.id)?.semanticConcept,
          answer: action.answer,
          correct,
          scored: false,
          at: new Date().toISOString(),
        });
      }
      if (scored && !duplicate && effects.some((e) => e.input.eventType === "recall"))
        scoreAttempt = { exerciseId: exercise.id, attemptId: action.attemptId };
      feedback = {
        correct,
        scored,
        ...courseExerciseFeedback(exercise),
      };
    } else throw new Error("Unknown action");
  }
  progress.updated_at = new Date().toISOString();
  // Write the learner's attempt and a pending receipt BEFORE any non-transactional
  // SRS effects. A crash leaves visible uncertainty, never a blindly retried effect.
  const receipts = effects.map((effect) => ({
    id: crypto.randomUUID(),
    status: "pending" as "pending" | "confirmed" | "uncertain",
    eventType: effect.input.eventType as "encounter" | "recall",
    targetId: effect.targetId,
    at: progress.updated_at,
  }));
  if (receipts.length) progress.sync_receipts = [...(progress.sync_receipts ?? []), ...receipts];
  await saveCourseProgress(db, userId, progress);
  if (effects.length) {
    try {
      for (let i = 0; i < effects.length; i++) {
        await recordInteraction(db, effects[i].input);
        receipts[i].status = "confirmed";
      }
      if (scoreAttempt)
        progress.exercises[scoreAttempt.exerciseId].attempts.find(
          (a) => a.id === scoreAttempt.attemptId,
        )!.scored = true;
      await saveCourseProgress(db, userId, progress);
    } catch {
      // A partial SRS update cannot be rolled back or retried safely with this
      // datastore contract. Keep the attempt, disclose uncertainty, require review.
      for (const receipt of receipts) receipt.status = "uncertain";
      if (scoreAttempt)
        progress.exercises[scoreAttempt.exerciseId].attempts.find(
          (a) => a.id === scoreAttempt.attemptId,
        )!.scored = false;
      if (feedback) feedback.scored = false;
      await saveCourseProgress(db, userId, progress);
    }
  }
  if (feedback && action.type === "answer")
    feedback.scored =
      progress.exercises[action.exerciseId].attempts.find((a) => a.id === action.attemptId)
        ?.scored ?? false;
  return { progress, ...(feedback ? { feedback } : {}) };
}
