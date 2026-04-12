import type { SupabaseClient } from "@supabase/supabase-js";

const CONVERSATION_WITH_MEMBERS = `
  *,
  members:conversation_members(
    user_id,
    target_languages,
    base_languages,
    joined_at,
    profile:profiles(user_id, display_name)
  ),
  agent_connector:agent_connectors(connector_id, name, type, config)
`;

export async function getConversationsForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  // Get conversation IDs the user belongs to, then fetch with members
  const { data: memberRows, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);

  if (memberError) throw memberError;
  if (!memberRows?.length) return [];

  const convIds = memberRows.map((m) => m.conversation_id);

  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_WITH_MEMBERS)
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getConversation(
  supabase: SupabaseClient,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_WITH_MEMBERS)
    .eq("conversation_id", conversationId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function createConversation(
  supabase: SupabaseClient,
  createdBy: string,
  agentConnectorId?: string,
) {
  const row: Record<string, unknown> = { created_by: createdBy };
  if (agentConnectorId) row.agent_connector_id = agentConnectorId;

  const { data, error } = await supabase
    .from("conversations")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getConversationByInvite(
  supabase: SupabaseClient,
  inviteCode: string,
) {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("invite_code", inviteCode)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}
