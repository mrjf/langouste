import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConnector } from "../../types/index.ts";

export async function getConnectorsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<AgentConnector[]> {
  const { data, error } = await supabase
    .from("agent_connectors")
    .select("*")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getConnector(
  supabase: SupabaseClient,
  connectorId: string,
): Promise<AgentConnector | null> {
  const { data, error } = await supabase
    .from("agent_connectors")
    .select("*")
    .eq("connector_id", connectorId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function createConnector(
  supabase: SupabaseClient,
  connector: Pick<AgentConnector, "name" | "type" | "config" | "created_by">,
): Promise<AgentConnector> {
  const { data, error } = await supabase
    .from("agent_connectors")
    .insert(connector)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteConnector(
  supabase: SupabaseClient,
  connectorId: string,
): Promise<void> {
  const { error } = await supabase
    .from("agent_connectors")
    .delete()
    .eq("connector_id", connectorId);

  if (error) throw error;
}
