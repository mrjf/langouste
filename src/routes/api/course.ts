import { Hono } from "hono";
import type { CourseAction } from "../../types/course.ts";
import { loadCourseCatalog, publicCourseLesson } from "../../services/course/catalog.ts";
import {
  actOnCourse,
  courseExerciseFeedback,
  emptyCourseProgress,
} from "../../services/course/progress.ts";
import { getCourseProgress, listCourseProgress } from "../../services/database/course.ts";
import { requireAuth } from "../middleware.ts";
import type { AuthenticatedRouteBindings } from "../types.ts";
export const courseRoutes = new Hono<AuthenticatedRouteBindings>();
courseRoutes.use("*", requireAuth);
courseRoutes.get("/", async (c) => {
  const lessons = await loadCourseCatalog();
  return c.json({
    lessons: lessons.map((l) => ({
      id: l.id,
      courseId: l.courseId,
      day: l.day,
      language: l.language,
      title: l.title,
      subtitle: l.subtitle,
      estimatedMinutes: l.estimatedMinutes,
      exerciseCount: l.exercises.length,
      objectives: l.objectives,
    })),
    progress: await listCourseProgress(c.get("db"), c.get("userId")),
  });
});
courseRoutes.get("/:id", async (c) => {
  const lesson = (await loadCourseCatalog()).find((l) => l.id === c.req.param("id"));
  if (!lesson) return c.json({ error: "Lesson not found" }, 404);
  const progress =
    (await getCourseProgress(c.get("db"), c.get("userId"), lesson.id)) ??
    emptyCourseProgress(lesson);
  const feedback = Object.fromEntries(
    lesson.exercises.flatMap((e) => {
      const state = progress.exercises[e.id];
      if (!state) return [];
      const last = state.attempts.at(-1);
      return [
        [
          e.id,
          last || state.revealed
            ? {
                ...courseExerciseFeedback(e),
                correct: last?.correct,
                scored: last?.scored,
              }
            : state.hinted
              ? { text: e.hint }
              : { text: "" },
        ],
      ];
    }),
  );
  return c.json({ lesson: publicCourseLesson(lesson), progress, feedback });
});
courseRoutes.post("/:id/actions", async (c) => {
  const lesson = (await loadCourseCatalog()).find((l) => l.id === c.req.param("id"));
  if (!lesson) return c.json({ error: "Lesson not found" }, 404);
  try {
    const action = await c.req.json<CourseAction>();
    if (!action || typeof action.type !== "string")
      return c.json({ error: "Invalid course action" }, 400);
    return c.json(await actOnCourse(c.get("db"), c.get("userId"), lesson, action));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid action" }, 400);
  }
});
