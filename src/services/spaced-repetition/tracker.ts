import type { SupabaseClient } from "@supabase/supabase-js";
import type { VocabularyExtractionOutput } from "../ai/types.ts";
import type { LanguageCode } from "../../types/index.ts";

/**
 * After processing a message, upsert new vocabulary and grammar gaps
 * into the database for the sender.
 */
export async function trackLearningProgress(
  supabase: SupabaseClient,
  userId: string,
  language: LanguageCode,
  aiResult: VocabularyExtractionOutput,
): Promise<void> {
  const vocabPromises = aiResult.new_vocabulary.map((v) =>
    supabase
      .from("vocabulary")
      .upsert(
        {
          user_id: userId,
          language,
          term: v.term,
          translation: v.translation,
          context_sentence: v.context_sentence,
          cefr_level: v.cefr_level,
        },
        { onConflict: "user_id,language,term" },
      )
  );

  const gapPromises = aiResult.grammar_gaps_detected.map((g) =>
    supabase.rpc("upsert_grammar_gap", {
      p_user_id: userId,
      p_language: language,
      p_category: g.category,
      p_description: g.description,
    })
  );

  await Promise.all([...vocabPromises, ...gapPromises]);
}

/**
 * Get vocabulary items and grammar gaps due for review.
 */
export async function getDueReviewItems(
  supabase: SupabaseClient,
  userId: string,
  language: LanguageCode,
  limit = 5,
): Promise<{ vocabulary: string[]; grammar_gaps: string[] }> {
  const now = new Date().toISOString();

  const [vocabResult, gapResult] = await Promise.all([
    supabase
      .from("vocabulary")
      .select("term")
      .eq("user_id", userId)
      .eq("language", language)
      .lte("next_review_at", now)
      .order("next_review_at")
      .limit(limit),
    supabase
      .from("grammar_gaps")
      .select("category")
      .eq("user_id", userId)
      .eq("language", language)
      .lte("next_review_at", now)
      .order("next_review_at")
      .limit(limit),
  ]);

  return {
    vocabulary: (vocabResult.data ?? []).map((v) => v.term),
    grammar_gaps: (gapResult.data ?? []).map((g) => g.category),
  };
}
