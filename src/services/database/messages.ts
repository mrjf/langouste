import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "../../types/index.ts";

export async function getMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reverse(); // return chronological order
}

export async function insertMessage(
  supabase: SupabaseClient,
  message: Pick<
    Message,
    | "conversation_id"
    | "sender_id"
    | "raw_text"
    | "healed_text"
    | "language"
    | "translation"
    | "translations"
    | "corrections"
    | "next_challenge"
  >,
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert(message)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getRecentMessageTexts(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 5,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("healed_text, sender_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).reverse().map((m) => m.healed_text);
}
