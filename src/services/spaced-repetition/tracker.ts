import type { Database } from "../../lib/db/index.ts";
import type { VocabularyExtractionOutput } from "../ai/types.ts";
import type { LanguageCode } from "../../types/index.ts";
import { recordInteraction } from "./interactions.ts";

/**
 * After processing a message, record each extracted vocabulary item (correct
 * production) and each detected grammar gap (incorrect production) as an
 * interaction. recordInteraction upserts the item row, updates roll-ups, and
 * writes to review_log. Scheduler state (SM-2) updates alongside.
 */
export async function trackLearningProgress(
  db: Database,
  userId: string,
  language: LanguageCode,
  aiResult: VocabularyExtractionOutput,
  messageId?: string,
): Promise<void> {
  const vocabPromises = aiResult.new_vocabulary.map((v) =>
    recordInteraction(db, {
      userId,
      language,
      itemType: "vocabulary",
      lookupKey: v.term,
      seed: {
        translation: v.translation,
        context_sentence: v.context_sentence ?? undefined,
        cefr_level: v.cefr_level ?? undefined,
      },
      eventType: "production",
      outcome: "correct",
      source: "chat_produce",
      messageId,
    }),
  );

  const gapPromises = aiResult.grammar_gaps_detected.map((g) =>
    recordInteraction(db, {
      userId,
      language,
      itemType: "grammar",
      lookupKey: g.category,
      seed: { description: g.description },
      eventType: "production",
      outcome: "incorrect",
      source: "chat_correct",
      messageId,
    }),
  );

  await Promise.all([...vocabPromises, ...gapPromises]);
}

/**
 * Get vocabulary items and grammar gaps due for review.
 */
export async function getDueReviewItems(
  db: Database,
  userId: string,
  language: LanguageCode,
  limit = 5,
): Promise<{ vocabulary: string[]; grammar_gaps: string[] }> {
  const now = new Date().toISOString();

  const [vocab, gaps] = await Promise.all([
    db.select<{ term: string }>("vocabulary", {
      columns: "term",
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
        { op: "lte", column: "next_review_at", value: now },
      ],
      order: [{ column: "next_review_at", ascending: true }],
      limit,
    }),
    db.select<{ category: string }>("grammar_gaps", {
      columns: "category",
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
        { op: "lte", column: "next_review_at", value: now },
      ],
      order: [{ column: "next_review_at", ascending: true }],
      limit,
    }),
  ]);

  return {
    vocabulary: vocab.map((v) => v.term),
    grammar_gaps: gaps.map((g) => g.category),
  };
}
