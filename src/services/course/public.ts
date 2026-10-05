import type { CourseLesson, PublicCourseLesson } from "../../types/course.ts";
export function publicCourseLesson(lesson: CourseLesson): PublicCourseLesson {
  return {
    ...lesson,
    exercises: lesson.exercises.map((e) => ({
      id: e.id,
      type: e.type,
      prompt: e.prompt,
      choices: e.choices,
      target: e.target,
      trackInSrs: e.trackInSrs,
      showChoiceEnglish: e.showChoiceEnglish,
      orderMode: e.orderMode,
      supportAtoms: e.supportAtoms,
      matchingPairs: e.matchingPairs?.map(({ answer: _answer, ...pair }) => pair),
      promptAtom: e.promptAtom
        ? {
            id: e.promptAtom.id,
            text: e.promptAtom.text,
            transliteration: e.promptAtom.transliteration,
            kind: e.promptAtom.kind,
            sourceIds: e.promptAtom.sourceIds,
          }
        : undefined,
      choiceSupport: e.choiceSupport
        ? Object.fromEntries(
            Object.entries(e.choiceSupport).map(([key, value]) => [
              key,
              {
                transliteration: value.transliteration,
                ...(e.showChoiceEnglish ? { english: value.english } : {}),
              },
            ]),
          )
        : undefined,
    })),
  };
}
