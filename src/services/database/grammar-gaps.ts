import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrammarGap } from "../../types/index.ts";
import { sm2 } from "../spaced-repetition/sm2.ts";

export async function getDueGrammarGaps(
  supabase: SupabaseClient,
  userId: string,
  language: string,
  limit = 10,
): Promise<GrammarGap[]> {
  const { data, error } = await supabase
    .from("grammar_gaps")
    .select("*")
    .eq("user_id", userId)
    .eq("language", language)
    .lte("next_review_at", new Date().toISOString())
    .order("next_review_at")
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function reviewGrammarGap(
  supabase: SupabaseClient,
  gapId: string,
  quality: number,
): Promise<void> {
  const { data, error } = await supabase
    .from("grammar_gaps")
    .select("ease_factor, interval_days, repetitions")
    .eq("gap_id", gapId)
    .single();

  if (error) throw error;

  const result = sm2(data, quality);

  const { error: updateError } = await supabase
    .from("grammar_gaps")
    .update({
      ease_factor: result.ease_factor,
      interval_days: result.interval_days,
      repetitions: result.repetitions,
      next_review_at: result.next_review_at.toISOString(),
      last_reviewed_at: new Date().toISOString(),
    })
    .eq("gap_id", gapId);

  if (updateError) throw updateError;
}
