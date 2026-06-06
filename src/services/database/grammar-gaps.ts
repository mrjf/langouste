import type { Database } from "../../lib/db/index.ts";
import type { GrammarGap } from "../../types/index.ts";

export async function getDueGrammarGaps(
  db: Database,
  userId: string,
  language: string,
  limit = 10,
): Promise<GrammarGap[]> {
  const now = new Date().toISOString();
  const dueConcepts = await db.select<{ concept_id: string; next_review_at: string }>(
    "concept_srs",
    {
      columns: "concept_id,next_review_at",
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
        { op: "lte", column: "next_review_at", value: now },
      ],
      order: [{ column: "next_review_at", ascending: true }],
      limit: Math.max(limit * 5, 50),
    },
  );

  if (dueConcepts.length > 0) {
    const conceptOrder = new Map(dueConcepts.map((c, index) => [c.concept_id, index]));
    const rows = await db.select<GrammarGap>("grammar_gaps", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
        { op: "in", column: "concept_id", values: dueConcepts.map((c) => c.concept_id) },
      ],
    });
    return rows
      .filter(isReviewableGrammarGap)
      .sort(
        (a, b) =>
          (conceptOrder.get(a.concept_id ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (conceptOrder.get(b.concept_id ?? "") ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, limit);
  }

  const hasConceptState = await db.selectOne("concept_srs", {
    columns: "concept_state_id",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
  });
  if (hasConceptState) return [];

  const rows = await db.select<GrammarGap>("grammar_gaps", {
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "lte", column: "next_review_at", value: now },
    ],
    order: [{ column: "next_review_at", ascending: true }],
    limit: Math.max(limit * 5, 50),
  });
  return rows.filter(isReviewableGrammarGap).slice(0, limit);
}

function isReviewableGrammarGap(gap: GrammarGap): boolean {
  return !isCefrCatalogKey(gap.category) && !isCefrCatalogKey(gap.concept_id);
}

function isCefrCatalogKey(value: string | null | undefined): boolean {
  return value?.startsWith("cefr:") === true;
}
