import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationMember } from "../../types/index.ts";

export async function addMember(
  supabase: SupabaseClient,
  member: Pick<ConversationMember, "conversation_id" | "user_id" | "target_languages" | "base_languages">,
): Promise<ConversationMember> {
  const { data, error } = await supabase
    .from("conversation_members")
    .insert(member)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMember(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<ConversationMember | null> {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function getMembers(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationMember[]> {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("*")
    .eq("conversation_id", conversationId);

  if (error) throw error;
  return data ?? [];
}

export async function updateMemberLanguages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  updates: Partial<Pick<ConversationMember, "target_languages" | "base_languages">>,
): Promise<ConversationMember> {
  const { data, error } = await supabase
    .from("conversation_members")
    .update(updates)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
