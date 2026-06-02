import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * In sqlite mode the client has no Supabase backend at all, so the helpers
 * below become no-ops. The database mode is surfaced to the browser via
 * VITE_DATABASE_MODE (Vite inlines this at build time).
 */
const MODE = (import.meta.env.VITE_DATABASE_MODE as string | undefined) ?? "supabase";
export const isSupabaseMode = MODE === "supabase";

let supabase: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient | null {
  if (!isSupabaseMode) return null;
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
 * Set the auth session on the Supabase client so realtime subscriptions pass
 * through RLS. No-op in sqlite mode.
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
  if (!supabase) return () => {};

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
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
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

/**
 * Subscribe to message INSERTs across every conversation the user can see
 * (RLS scopes the stream). Used by the sidebar to drive unread badges
 * without a per-conversation channel. No-op in sqlite mode.
 */
export function subscribeToAllMessages(
  onMessage: (msg: Record<string, unknown>) => void,
): () => void {
  if (!supabase) return () => {};

  const channel = supabase
    .channel("messages:all")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) =>
      onMessage(payload.new as Record<string, unknown>),
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
  if (!supabase) return () => {};

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
