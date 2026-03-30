import type { SupabaseClient } from "@supabase/supabase-js";
import type { VocabularyItem } from "../../types/index.ts";
import { sm2 } from "../spaced-repetition/sm2.ts";

export async function getDueVocabulary(
  supabase: SupabaseClient,
  userId: string,
  language: string,
  limit = 10,
): Promise<VocabularyItem[]> {
  const { data, error } = await supabase
    .from("vocabulary")
    .select("*")
    .eq("user_id", userId)
    .eq("language", language)
    .lte("next_review_at", new Date().toISOString())
    .order("next_review_at")
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function reviewVocabulary(
  supabase: SupabaseClient,
  vocabId: string,
  quality: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("vocabulary")
    .select("ease_factor, interval_days, repetitions")
    .eq("vocab_id", vocabId)
    .single();

  if (error) throw error;

  const result = sm2(data, quality);

  const { error: updateError } = await supabase
    .from("vocabulary")
    .update({
      ease_factor: result.ease_factor,
      interval_days: result.interval_days,
      repetitions: result.repetitions,
      next_review_at: result.next_review_at.toISOString(),
      last_reviewed_at: new Date().toISOString(),
    })
    .eq("vocab_id", vocabId);

  if (updateError) throw updateError;
}
