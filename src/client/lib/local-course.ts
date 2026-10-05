import type {
  CourseAction,
  CourseActionResult,
  CourseLesson,
  CourseProgress,
} from "../../types/course.ts";
import {
  courseExerciseFeedback,
  emptyCourseProgress,
  normalizeCourseAnswer,
} from "../../services/course/state.ts";
import { publicCourseLesson } from "../../services/course/public.ts";
const prefix = "langouste-course-local:v1:";
export function applyLocalAction(
  lesson: CourseLesson,
  previous: CourseProgress,
  action: CourseAction,
): CourseActionResult {
  const progress = structuredClone(previous);
  let feedback: CourseActionResult["feedback"];
  function encounter(type: "vocabulary" | "grammar", id: string) {
    if (!(type === "vocabulary" ? lesson.vocabulary : lesson.concepts).some((v) => v.id === id))
      throw Error("Unknown learning target");
    const key = `${type}:${id}`;
    if (!progress.encounters.includes(key)) progress.encounters.push(key);
  }
  if (action.type === "navigate") {
    if (!["read", "words", "grammar", "practice"].includes(action.step))
      throw Error("Invalid step");
    progress.step = action.step;
  } else if (action.type === "read") {
    if (!lesson.readings.some((r) => r.id === action.sectionId)) throw Error("Unknown reading");
    if (!progress.read_sections.includes(action.sectionId)) {
      progress.read_sections.push(action.sectionId);
      progress.reading_evidence ??= [];
      progress.reading_evidence.push({
        sectionId: action.sectionId,
        englishVisible: action.englishVisible === true,
        transliterationVisible: action.transliterationVisible === true,
        at: new Date().toISOString(),
      });
    }
  } else if (action.type === "encounter") encounter(action.itemType, action.targetId);
  else if (action.type === "complete") {
    if (
      progress.read_sections.length < lesson.readings.length ||
      lesson.exercises.some((e) => !progress.exercises[e.id]?.attempts.length)
    )
      throw Error("Read each section and attempt each exercise first");
    progress.completed_at ??= new Date().toISOString();
  } else {
    const e = lesson.exercises.find((e) => e.id === action.exerciseId);
    if (!e) throw Error("Unknown exercise");
    progress.exercises[e.id] ??= { hinted: false, revealed: false, attempts: [] };
    const state = progress.exercises[e.id];
    if (action.type === "hint") {
      state.hinted = true;
      feedback = { text: e.hint };
    } else if (action.type === "reveal") {
      state.revealed = true;
      encounter(e.target.type, e.target.id);
      feedback = courseExerciseFeedback(e);
    } else if (action.type === "self-assess") {
      if (
        e.type !== "self-check" ||
        !state.attempts.length ||
        !["again", "close", "met"].includes(action.assessment)
      )
        throw Error("Attempt this self-check first");
      state.attempts.at(-1)!.selfAssessment = action.assessment;
      feedback = { ...courseExerciseFeedback(e), scored: false };
    } else if (action.type === "answer") {
      if (
        typeof action.answer !== "string" ||
        !action.answer.trim() ||
        action.answer.length > 2000 ||
        typeof action.attemptId !== "string" ||
        !action.attemptId ||
        action.attemptId.length > 100
      )
        throw Error("A bounded answer and attempt ID are required");
      const duplicate = state.attempts.find((a) => a.id === action.attemptId);
      if (duplicate && duplicate.answer !== action.answer)
        throw Error("Attempt ID already used for another answer");
      let pairResults: CourseProgress["exercises"][string]["attempts"][number]["pairResults"];
      if (e.type === "matching") {
        let submitted: Record<string, string>;
        try {
          submitted = JSON.parse(action.answer);
        } catch {
          throw Error("Match each pair first");
        }
        if (
          !submitted ||
          typeof submitted !== "object" ||
          e.matchingPairs?.some((p) => !e.choices?.includes(submitted[p.id]))
        )
          throw Error("Match each pair first");
        pairResults = e.matchingPairs?.map((p) => ({
          id: p.id,
          targetId: p.target?.id,
          semanticConcept: p.target?.semanticConcept,
          correct: submitted[p.id] === p.answer,
        }));
      }
      const correct = duplicate
        ? duplicate.correct
        : e.type === "self-check"
          ? null
          : pairResults
            ? pairResults.every((p) => p.correct)
            : e.acceptedAnswers.some(
                (a) =>
                  normalizeCourseAnswer(a, lesson.language) ===
                  normalizeCourseAnswer(action.answer, lesson.language),
              );
      const scored =
        duplicate?.scored ??
        (e.type === "recall" &&
          e.trackInSrs !== false &&
          !action.transliterationVisible &&
          !action.supportUsed &&
          !e.supportAtoms?.length &&
          !state.hinted &&
          !state.revealed &&
          !state.attempts.length);
      if (!duplicate) {
        if (state.attempts.length >= 100) throw Error("Practice attempt limit reached");
        if (e.type === "matching")
          for (const p of e.matchingPairs ?? []) {
            if (p.target) encounter(p.target.type, p.target.id);
          }
        else encounter(e.target.type, e.target.id);
        state.attempts.push({
          ...(action.evidenceVersion === 2 ? {evidenceVersion: 2 as const, supportUsed: action.supportUsed === true, contentVersion: contentVersion(lesson), direction: /english|meaning/i.test(e.prompt) ? "meaning" : /hungarian|arabic|egyptian/i.test(e.prompt) ? "target-language" : "authored-prompt", support: {hint:state.hinted,answer:state.revealed,transliteration:action.transliterationVisible===true,reference:action.supportUsed===true,supplied:!!e.supportAtoms?.length}} : {}),
          id: action.attemptId,
          answer: action.answer,
          correct,
          scored,
          pairResults,
          targetId: e.target.id,
          semanticConcept:
            e.target.semanticConcept ??
            lesson.vocabulary.find((v) => v.id === e.target.id)?.semanticConcept,
          transliterationVisible: action.transliterationVisible === true,
          responseMode: /[\u0600-\u06ff]/u.test(action.answer)
            ? "arabic-script"
            : /[a-zA-Z]/u.test(action.answer)
              ? "latin"
              : "other",
          at: new Date().toISOString(),
        });
      }
      feedback = { ...courseExerciseFeedback(e), correct, scored };
    } else throw Error("Unknown action");
  }
  progress.updated_at = new Date().toISOString();
  return { progress, feedback };
}
function read(id: string): CourseProgress | null {
  const raw = localStorage.getItem(prefix + id);
  if (!raw) return null;
  let p: CourseProgress;
  try {
    p = JSON.parse(raw);
  } catch {
    throw Error("Saved browser progress is unreadable. It has not been overwritten.");
  }
  if (
    p.lesson_id !== id ||
    !p.exercises ||
    !Array.isArray(p.read_sections) ||
    !Array.isArray(p.encounters) ||
    !["read", "words", "grammar", "practice"].includes(p.step)
  )
    throw Error("Saved browser progress has an unsupported format. It has not been overwritten.");
  return p;
}
async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw Error("Could not load lesson. Please retry when online.");
  return r.json();
}
export async function localCourseRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (path === "/course") {
    const lessons = await getJSON<{ id: string }[]>("/course/catalog.json");
    return { lessons, progress: lessons.map((l) => read(l.id)).filter(Boolean) } as T;
  }
  const match = path.match(/^\/course\/([\w-]+)(\/actions)?$/);
  if (!match) throw Error("Unknown course route");
  const lesson = await getJSON<CourseLesson>(`/course/lessons/${match[1]}.json`);
  if (match[2]) {
    const action = JSON.parse(String(options.body)) as CourseAction;
    const save = () => {
      const result = applyLocalAction(
        lesson,
        read(lesson.id) ?? emptyCourseProgress(lesson),
        action,
      );
      try {
        localStorage.setItem(prefix + lesson.id, JSON.stringify(result.progress));
      } catch {
        throw Error("This browser could not save your progress. Allow site storage and try again.");
      }
      return result as T;
    };
    if (navigator.locks) return navigator.locks.request(prefix + lesson.id, save);
    throw Error(
      "Safe browser storage requires a browser with Web Locks support. Your records have not been changed.",
    );
  }
  const progress = read(lesson.id) ?? emptyCourseProgress(lesson);
  const feedback = Object.fromEntries(
    lesson.exercises.flatMap((e) => {
      const s = progress.exercises[e.id];
      if (!s) return [];
      const a = s.attempts.at(-1);
      return [
        [
          e.id,
          a || s.revealed
            ? { ...courseExerciseFeedback(e), correct: a?.correct, scored: a?.scored }
            : s.hinted
              ? { text: e.hint }
              : { text: "" },
        ],
      ];
    }),
  );
  return { lesson: publicCourseLesson(lesson), progress, feedback } as T;
}

/** Stable content fingerprint for interpreting future evidence; not a security hash. */
export function contentVersion(lesson:CourseLesson):string {let hash=2166136261;for(const char of JSON.stringify(lesson))hash=Math.imul(hash^char.charCodeAt(0),16777619);return `course-v1-${(hash>>>0).toString(16)}`;}
