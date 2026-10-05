import type { Database } from "../../lib/db/types.ts";
export interface CourseAccount {
  user_id: string;
  email: string;
  password_hash: string;
}
export function findCourseAccount(db: Database, email: string) {
  return db.selectOne<CourseAccount>("users", {
    filters: [{ op: "eq", column: "email", value: email }],
  });
}
export function courseAccountById(db: Database, id: string) {
  return db.selectOne<CourseAccount>("users", {
    filters: [{ op: "eq", column: "user_id", value: id }],
  });
}
