import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (supabase) return supabase;
  supabase = createClient(url, anonKey, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  return supabase;
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

/**
 * Set the auth session on the Supabase client so realtime
 * subscriptions pass through RLS.
 */
export async function setRealtimeAuth(accessToken: string, refreshToken: string) {
  if (!supabase) return;
  await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

export function subscribeToMessages(
  conversationId: string,
  onMessage: (msg: Record<string, unknown>) => void,
): () => void {
  if (!supabase) {
    console.warn("Supabase not initialized, skipping realtime subscription");
    return () => {};
  }

  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(payload.new as Record<string, unknown>),
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

export function subscribeToConversation(
  conversationId: string,
  onUpdate: (conv: Record<string, unknown>) => void,
): () => void {
  if (!supabase) {
    console.warn("Supabase not initialized, skipping conversation subscription");
    return () => {};
  }

  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversations",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onUpdate(payload.new as Record<string, unknown>),
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}
