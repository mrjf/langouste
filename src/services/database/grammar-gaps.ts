import type { Database } from "../../lib/db/index.ts";
import type { GrammarGap } from "../../types/index.ts";

export async function getDueGrammarGaps(
  db: Database,
  userId: string,
  language: string,
  limit = 10,
): Promise<GrammarGap[]> {
  return db.select<GrammarGap>("grammar_gaps", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "lte", column: "next_review_at", value: new Date().toISOString() },
    ],
    order: [{ column: "next_review_at", ascending: true }],
    limit,
  });
}
