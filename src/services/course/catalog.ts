import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  CourseLesson,
  CourseSentence,
  CourseSource,
} from "../../types/course.ts";

export interface CourseBundle {
  schemaVersion: 1;
  sourceRegistry: CourseSource[];
  sourceReadings?: (CourseSentence & { language: string })[];
  lessons: (Omit<CourseLesson, "sources"> & { sourceIds: string[] })[];
}
export const courseDirectory = new URL("../../../content/ai-course/", import.meta.url).pathname;

export function validateCourseBundle(input: unknown): CourseBundle {
  const bundle = input as CourseBundle;
  if (
    !bundle ||
    bundle.schemaVersion !== 1 ||
    !Array.isArray(bundle.sourceRegistry) ||
    !Array.isArray(bundle.lessons)
  )
    throw new Error("Expected schemaVersion 1, sourceRegistry and lessons arrays");
  const sources = new Set<string>();
  for (const source of bundle.sourceRegistry) {
    if (
      !source.id ||
      sources.has(source.id) ||
      !source.title ||
      !source.publisher ||
      !source.factSummary ||
      !/^https:\/\//u.test(source.url) ||
      (source.publishedOn !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(source.publishedOn))
    )
      throw new Error("Invalid or duplicate dated source");
    sources.add(source.id);
  }
  const ids = new Set<string>();
  for (const stored of bundle.lessons) {
    const lesson = resolveReadings(stored, bundle);
    if (
      lesson.schemaVersion !== 1 ||
      !/^[\w-]+$/u.test(lesson.id) ||
      ids.has(lesson.id) ||
      !["hu", "ar-EG"].includes(lesson.language) ||
      !Number.isInteger(lesson.day) ||
      lesson.day < 1 ||
      !lesson.title ||
      !lesson.courseId
    )
      throw new Error("Invalid or duplicate lesson metadata");
    ids.add(lesson.id);
    if (!lesson.sourceIds?.length || lesson.sourceIds.some((id) => !sources.has(id)))
      throw new Error(`Unresolved sources: ${lesson.id}`);
    if (
      !lesson.readings?.length ||
      !lesson.vocabulary?.length ||
      !lesson.concepts?.length ||
      !lesson.exercises?.length
    )
      throw new Error(`Missing learning content: ${lesson.id}`);
    const targets = new Set([...lesson.vocabulary, ...lesson.concepts].map((v) => v.id));
    const exerciseIds = new Set<string>();
    for (const exercise of lesson.exercises) {
      if (
        !exercise.id ||
        exerciseIds.has(exercise.id) ||
        !["choice", "recall", "order", "self-check", "matching"].includes(exercise.type) ||
        !exercise.acceptedAnswers?.length ||
        exercise.acceptedAnswers.some((a) => typeof a !== "string" || !a.trim()) ||
        !exercise.hint ||
        typeof exercise.explanation !== "string" ||
        !targets.has(exercise.target?.id)
      )
        throw new Error(`Invalid exercise: ${lesson.id}/${exercise.id}`);
      if (exercise.target.type !== "grammar" && exercise.target.type !== "vocabulary")
        throw new Error("Invalid target type");
      if (["choice", "order"].includes(exercise.type) && !exercise.choices?.length)
        throw new Error("Choices/tokens required");
      if (exercise.targetIds?.some((id) => !targets.has(id)))
        throw new Error("Unknown secondary exercise target");
      exerciseIds.add(exercise.id);
    }
    const sentences = [
      ...lesson.readings.flatMap((r) => r.sentences),
      ...lesson.vocabulary.map((v) => v.example),
      ...lesson.concepts.flatMap((g) => g.examples),
      ...(lesson.optionalDialogue ?? []),
      ...(lesson.instructionBlocks?.flatMap((b) => b.examples ?? []) ?? []),
    ];
    for (const sentence of sentences) {
      if (
        !sentence.id ||
        !sentence.text ||
        !sentence.english ||
        !["source-summary", "teaching-example"].includes(sentence.kind) ||
        !Array.isArray(sentence.sourceIds) ||
        sentence.sourceIds.some((id) => !sources.has(id))
      )
        throw new Error(`Invalid sentence: ${lesson.id}`);
      if (sentence.kind === "source-summary" && !sentence.sourceIds.length)
        throw new Error("Factual summaries require source attribution");
      if (lesson.language === "ar-EG" && !sentence.transliteration)
        throw new Error(`Egyptian Arabic transliteration missing: ${lesson.id}/${sentence.id}`);
    }
  }
  return bundle;
}

export async function loadCourseCatalog(): Promise<CourseLesson[]> {
  const files = (await readdir(courseDirectory)).filter((f) => f.endsWith(".json")).sort();
  const lessons = new Map<string, CourseLesson>();
  for (const file of files) {
    const bundle = validateCourseBundle(await Bun.file(join(courseDirectory, file)).json());
    for (const lesson of bundle.lessons) {
      if (lessons.has(lesson.id)) throw new Error(`Duplicate installed lesson ${lesson.id}`);
      lessons.set(lesson.id, {
        ...resolveReadings(lesson, bundle),
        sources: lesson.sourceIds.map((id) => bundle.sourceRegistry.find((s) => s.id === id)!),
      });
    }
  }
  return [...lessons.values()].sort(
    (a, b) =>
      a.courseId.localeCompare(b.courseId) || a.day - b.day || a.language.localeCompare(b.language),
  );
}
function resolveReadings(lesson: CourseBundle["lessons"][number], bundle: CourseBundle) {
  return {
    ...lesson,
    readings: lesson.readings.map((r) => ({
      ...r,
      recognitionOnly:r.recognitionOnly?.map((item,index)=>{
        const legacy=item as CourseSentence & {hungarian?:string};
        return legacy.text?legacy:{...legacy,id:`${r.id}:recognition:${index}`,text:legacy.hungarian??"",kind:"teaching-example" as const,sourceIds:[]};
      }),
      sentences: [
        ...(r.sourceSentenceRefs ?? []).map((id) => {
          const sentence = bundle.sourceReadings?.find(
            (s) => s.id === id && s.language === lesson.language,
          );
          if (!sentence) throw new Error(`Unresolved source sentence ${id}`);
          return sentence;
        }),
        ...r.sentences,
      ],
    })),
  };
}
export { publicCourseLesson } from "./public.ts";
