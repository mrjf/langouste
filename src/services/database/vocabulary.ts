import type { Database } from "../../lib/db/index.ts";
import type { VocabularyItem } from "../../types/index.ts";

export async function getDueVocabulary(
  db: Database,
  userId: string,
  language: string,
  limit = 10,
): Promise<VocabularyItem[]> {
  return db.select<VocabularyItem>("vocabulary", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "lte", column: "next_review_at", value: new Date().toISOString() },
    ],
    order: [{ column: "next_review_at", ascending: true }],
    limit,
  });
}
