import { createHash } from "node:crypto";
import type { Database } from "../../lib/db/index.ts";
import type { CourseProgress } from "../../types/course.ts";

const id = (userId: string, lessonId: string) =>
  createHash("sha256").update(`${userId}\0${lessonId}`).digest("hex");

export async function getCourseProgress(db: Database, userId: string, lessonId: string) {
  // Older rows predate a filterable lesson_id projection. Scope by the indexed
  // owner first so those existing records remain readable without a migration.
  const rows = await listCourseProgress(db, userId);
  return rows.find((row) => row.lesson_id === lessonId) ?? null;
}
export async function listCourseProgress(db: Database, userId: string) {
  return db.select<CourseProgress>("course_progress", {
    filters: [{ op: "eq", column: "user_id", value: userId }],
    limit: 10000,
  });
}
export async function saveCourseProgress(db: Database, userId: string, progress: CourseProgress) {
  await db.upsert(
    "course_progress",
    {
      ...progress,
      progress_id: id(userId, progress.lesson_id),
      user_id: userId,
    },
    ["user_id", "lesson_id"],
  );
}
