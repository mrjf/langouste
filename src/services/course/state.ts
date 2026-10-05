import type { CourseExercise, CourseLesson, CourseProgress } from "../../types/course.ts";
export function courseExerciseFeedback(exercise: CourseExercise) {
  return {
    text: exercise.explanation,
    answer: exercise.modelAnswer || exercise.acceptedAnswers[0],
    choiceSupport: exercise.choiceSupport,
    answerAtoms: exercise.answerAtoms,
    rubricText: exercise.type === "self-check" ? exercise.rubricText : undefined,
    promptEnglish: exercise.promptAtom?.english,
  };
}

export function emptyCourseProgress(lesson: CourseLesson): CourseProgress {
  return {
    lesson_id: lesson.id,
    language: lesson.language,
    read_sections: [],
    encounters: [],
    exercises: {},
    step: "read",
    completed_at: null,
    updated_at: "",
  };
}
/** Keep Hungarian vowel distinctions; only normalize orthography, not meaning. */
export function normalizeCourseAnswer(value: string, language: string): string {
  let result = value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase(language === "hu" ? "hu" : "en");
  if (language === "ar-EG") result = result.replace(/[\u064b-\u065f\u0670\u0640]/gu, "");
  return result
    .replace(/[.,!?؟،;:]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
