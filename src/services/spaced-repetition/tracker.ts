import type { Database } from "../../lib/db/index.ts";
import type { VocabularyExtractionOutput } from "../ai/types.ts";
import type { LanguageCode, SelfCorrectedSpan } from "../../types/index.ts";
import { getDueGrammarGaps } from "../database/grammar-gaps.ts";
import { getDueVocabulary } from "../database/vocabulary.ts";
import {
  grammarDescriptionForCategory,
  normalizeGrammarCategory,
} from "../profile/grammar-ontology.ts";
import { recordInteraction } from "./interactions.ts";

/**
 * After processing a message, record each extracted vocabulary item (correct
 * production) and each detected grammar gap (incorrect production) as an
 * interaction. recordInteraction upserts the item row, updates roll-ups, and
 * writes to review_log. FSRS concept state updates alongside.
 */
export async function trackLearningProgress(
  db: Database,
  userId: string,
  language: LanguageCode,
  aiResult: VocabularyExtractionOutput,
  messageId?: string,
  selfCorrectedSpans: SelfCorrectedSpan[] = [],
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
      outcome: wasSelfCorrected(v.term, selfCorrectedSpans) ? "incorrect" : "correct",
      source: wasSelfCorrected(v.term, selfCorrectedSpans) ? "chat_self_correct" : "chat_produce",
      messageId,
    }),
  );

  const gapPromises = aiResult.grammar_gaps_detected.flatMap((g) => {
    const category = normalizeGrammarCategory(g.category, language);
    if (!category) return [];
    return [
      recordInteraction(db, {
        userId,
        language,
        itemType: "grammar",
        lookupKey: category,
        seed: { description: grammarDescriptionForCategory(category, language) },
        evidence: { commentary: g.description },
        eventType: "production",
        outcome: "incorrect",
        source: "chat_correct",
        messageId,
      }),
    ];
  });

  const selfCorrectedGrammarPromises = selfCorrectedSpans
    .filter((span) => span.kind === "grammar")
    .flatMap((span) => {
      const category = normalizeGrammarCategory(span.category, language);
      if (!category) return [];
      return [
        recordInteraction(db, {
          userId,
          language,
          itemType: "grammar",
          lookupKey: category,
          seed: { description: grammarDescriptionForCategory(category, language) },
          evidence: {
            commentary:
              span.explanation ??
              `Self-corrected "${span.original}" to "${span.corrected}" before sending.`,
            original: span.original,
            corrected: span.corrected,
          },
          eventType: "production",
          outcome: "incorrect",
          source: "chat_self_correct",
          messageId,
        }),
      ];
    });

  await Promise.all([...vocabPromises, ...gapPromises, ...selfCorrectedGrammarPromises]);
}

/**
 * Record vocabulary the learner encountered in target-language input. This is
 * intentionally separate from production: seeing a word should grow exposure
 * history and link back to the message, but it should not count as successful
 * recall or advance FSRS scheduling.
 */
export async function trackVocabularyEncounters(
  db: Database,
  userId: string,
  language: LanguageCode,
  aiResult: VocabularyExtractionOutput,
  messageId?: string,
): Promise<void> {
  const unique = new Map<string, VocabularyExtractionOutput["new_vocabulary"][number]>();
  for (const vocab of aiResult.new_vocabulary) {
    const key = normalizeForMatch(vocab.term);
    if (key && !unique.has(key)) unique.set(key, vocab);
  }

  await Promise.all(
    [...unique.values()].map(async (v) => {
      if (messageId && (await hasEncounterForMessage(db, userId, language, v.term, messageId))) {
        return;
      }
      await recordInteraction(db, {
        userId,
        language,
        itemType: "vocabulary",
        lookupKey: v.term,
        seed: {
          translation: v.translation,
          context_sentence: v.context_sentence ?? undefined,
          cefr_level: v.cefr_level ?? undefined,
        },
        eventType: "encounter",
        source: "chat_encounter",
        messageId,
      });
    }),
  );
}

async function hasEncounterForMessage(
  db: Database,
  userId: string,
  language: LanguageCode,
  term: string,
  messageId: string,
): Promise<boolean> {
  const existing = await db.selectOne<{ vocab_id: string }>("vocabulary", {
    columns: "vocab_id",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "eq", column: "term", value: term },
    ],
  });
  if (!existing) return false;

  const log = await db.selectOne<{ log_id: string }>("review_log", {
    columns: "log_id",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "language", value: language },
      { op: "eq", column: "item_type", value: "vocabulary" },
      { op: "eq", column: "item_id", value: existing.vocab_id },
      { op: "eq", column: "event_type", value: "encounter" },
      { op: "eq", column: "source", value: "chat_encounter" },
      { op: "eq", column: "message_id", value: messageId },
    ],
    limit: 1,
  });
  return !!log;
}

function wasSelfCorrected(term: string, spans: SelfCorrectedSpan[]): boolean {
  const normalizedTerm = normalizeForMatch(term);
  if (!normalizedTerm) return false;
  return spans.some((span) => {
    const candidates = [span.original, span.corrected].map(normalizeForMatch);
    return candidates.some(
      (candidate) => candidate === normalizedTerm || candidate.includes(normalizedTerm),
    );
  });
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const [vocab, gaps] = await Promise.all([
    getDueVocabulary(db, userId, language, limit),
    getDueGrammarGaps(db, userId, language, limit),
  ]);

  return {
    vocabulary: vocab.map((v) => v.term),
    grammar_gaps: gaps.map((g) => g.category),
  };
}
