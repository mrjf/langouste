import type { Database } from "../../lib/db/index.ts";

export type ExerciseProgressItemType = "vocabulary" | "grammar";
export type ExerciseProgressOutcome = "correct" | "partial" | "incorrect";

export interface ExerciseProgressTarget {
  itemType: ExerciseProgressItemType;
  itemId?: string | null;
  conceptId?: string | null;
}

export interface ExerciseProgressRollup {
  scored_attempts: number;
  scored_correct: number;
  scored_partial: number;
  scored_incorrect: number;
  /**
   * Weighted score in [0, 1] across scored recall/production events.
   * Correct = 1, partial = 0.5, incorrect = 0.
   * Null means the item has no scored learning evidence in review_log.
   */
  accuracy_score: number | null;
  last_scored_at: string | null;
  exercise_attempts: number;
  exercise_correct: number;
  exercise_partial: number;
  exercise_incorrect: number;
  /**
   * Weighted score in [0, 1]. Correct = 1, partial = 0.5, incorrect = 0.
   * Null means the item has no scored exercise evidence.
   */
  exercise_score: number | null;
  last_exercised_at: string | null;
}

export type ExerciseProgressLookup = Map<string, ExerciseProgressRollup>;

interface ExerciseProgressLogRow {
  item_type: string;
  item_id: string | null;
  concept_id: string | null;
  event_type: string;
  outcome: ExerciseProgressOutcome | null;
  quality: number | null;
  source: string;
  observed_at: string;
}

interface MutableRollup {
  scored_attempts: number;
  scored_correct: number;
  scored_partial: number;
  scored_incorrect: number;
  scored_total: number;
  last_scored_at: string | null;
  exercise_attempts: number;
  exercise_correct: number;
  exercise_partial: number;
  exercise_incorrect: number;
  score_total: number;
  last_exercised_at: string | null;
}

export function emptyExerciseProgress(): ExerciseProgressRollup {
  return {
    scored_attempts: 0,
    scored_correct: 0,
    scored_partial: 0,
    scored_incorrect: 0,
    accuracy_score: null,
    last_scored_at: null,
    exercise_attempts: 0,
    exercise_correct: 0,
    exercise_partial: 0,
    exercise_incorrect: 0,
    exercise_score: null,
    last_exercised_at: null,
  };
}

export async function getExerciseProgressLookup(
  db: Database,
  userId: string,
  language: string,
): Promise<ExerciseProgressLookup> {
  const rows = await db.select<ExerciseProgressLogRow>("review_log", {
    columns: "item_type,item_id,concept_id,event_type,outcome,quality,source,observed_at",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
    ],
  });

  const mutable = new Map<string, MutableRollup>();
  for (const row of rows) {
    if (row.event_type !== "recall" && row.event_type !== "production") continue;
    if (!isExerciseProgressItemType(row.item_type)) continue;
    const outcome = row.outcome ?? outcomeFromQuality(row.quality);
    if (!outcome) continue;

    for (const key of progressKeysForLog(row)) {
      const rollup = mutable.get(key) ?? newMutableRollup();
      rollup.scored_attempts++;
      if (outcome === "correct") rollup.scored_correct++;
      if (outcome === "partial") rollup.scored_partial++;
      if (outcome === "incorrect") rollup.scored_incorrect++;
      rollup.scored_total += scoreForOutcome(outcome);
      if (!rollup.last_scored_at || row.observed_at > rollup.last_scored_at) {
        rollup.last_scored_at = row.observed_at;
      }
      if (row.source === "exercise") {
        rollup.exercise_attempts++;
        if (outcome === "correct") rollup.exercise_correct++;
        if (outcome === "partial") rollup.exercise_partial++;
        if (outcome === "incorrect") rollup.exercise_incorrect++;
        rollup.score_total += scoreForOutcome(outcome);
        if (!rollup.last_exercised_at || row.observed_at > rollup.last_exercised_at) {
          rollup.last_exercised_at = row.observed_at;
        }
      }
      mutable.set(key, rollup);
    }
  }

  return new Map(
    [...mutable.entries()].map(([key, rollup]) => [
      key,
      {
        scored_attempts: rollup.scored_attempts,
        scored_correct: rollup.scored_correct,
        scored_partial: rollup.scored_partial,
        scored_incorrect: rollup.scored_incorrect,
        accuracy_score:
          rollup.scored_attempts > 0 ? rollup.scored_total / rollup.scored_attempts : null,
        last_scored_at: rollup.last_scored_at,
        exercise_attempts: rollup.exercise_attempts,
        exercise_correct: rollup.exercise_correct,
        exercise_partial: rollup.exercise_partial,
        exercise_incorrect: rollup.exercise_incorrect,
        exercise_score:
          rollup.exercise_attempts > 0 ? rollup.score_total / rollup.exercise_attempts : null,
        last_exercised_at: rollup.last_exercised_at,
      },
    ]),
  );
}

export function getExerciseProgressForTarget(
  lookup: ExerciseProgressLookup,
  target: ExerciseProgressTarget,
): ExerciseProgressRollup {
  if (target.itemId) {
    const byItem = lookup.get(progressKeyForItem(target.itemType, target.itemId));
    if (byItem) return byItem;
  }
  if (target.conceptId) {
    const byConcept = lookup.get(progressKeyForConcept(target.itemType, target.conceptId));
    if (byConcept) return byConcept;
  }
  return emptyExerciseProgress();
}

function progressKeysForLog(row: ExerciseProgressLogRow): string[] {
  if (!isExerciseProgressItemType(row.item_type)) return [];
  const itemType = row.item_type;
  const keys = new Set<string>();
  if (row.item_id) keys.add(progressKeyForItem(itemType, row.item_id));
  if (row.concept_id) keys.add(progressKeyForConcept(itemType, row.concept_id));
  return [...keys];
}

function isExerciseProgressItemType(value: string): value is ExerciseProgressItemType {
  return value === "vocabulary" || value === "grammar";
}

function progressKeyForItem(itemType: ExerciseProgressItemType, itemId: string): string {
  return `${itemType}:item:${itemId}`;
}

function progressKeyForConcept(itemType: ExerciseProgressItemType, conceptId: string): string {
  return `${itemType}:concept:${conceptId}`;
}

function newMutableRollup(): MutableRollup {
  return {
    scored_attempts: 0,
    scored_correct: 0,
    scored_partial: 0,
    scored_incorrect: 0,
    scored_total: 0,
    last_scored_at: null,
    exercise_attempts: 0,
    exercise_correct: 0,
    exercise_partial: 0,
    exercise_incorrect: 0,
    score_total: 0,
    last_exercised_at: null,
  };
}

function outcomeFromQuality(quality: number | null): ExerciseProgressOutcome | null {
  if (typeof quality !== "number") return null;
  if (quality >= 4) return "correct";
  if (quality >= 3) return "partial";
  return "incorrect";
}

function scoreForOutcome(outcome: ExerciseProgressOutcome): number {
  if (outcome === "correct") return 1;
  if (outcome === "partial") return 0.5;
  return 0;
}
