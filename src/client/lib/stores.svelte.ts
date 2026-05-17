// Svelte 5 runes-based reactive state

export interface UserSession {
  access_token: string;
  refresh_token: string;
  [key: string]: unknown;
}

export interface User {
  id: string;
  email: string;
  [key: string]: unknown;
}

export interface Profile {
  user_id: string;
  display_name: string;
  base_language: string;
  learning_languages: Array<{ lang: string; cefr_level: string; assessed_at: string }>;
  [key: string]: unknown;
}

export interface ConversationMember {
  user_id: string;
  target_languages: Array<{ lang: string; cefr_level: string }>;
  base_languages: string[];
  joined_at: string;
  last_read_at?: string;
  profile?: { user_id: string; display_name: string } | null;
}

export interface AgentConnector {
  connector_id: string;
  name: string;
  type: "openclaw" | "claude" | "claude-code" | "http" | "stub";
  config: Record<string, unknown>;
}

export interface Conversation {
  conversation_id: string;
  created_by: string;
  agent_connector_id: string;
  agent_connector?: AgentConnector | null;
  created_at: string;
  members: ConversationMember[];
  /** Unread agent messages (server-computed on list fetch). Live-updated
   *  client-side via the Realtime subscription / mark-read. */
  unread_count?: number;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  raw_text: string;
  healed_text: string;
  language: string | null;
  translation: string | null;
  translations: Record<string, string>;
  corrections: Correction[];
  next_challenge: string | null;
  is_agent?: boolean;
  created_at: string;
  _pending?: boolean;
}

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  category: string;
}

// Reactive state using Svelte 5 runes
export const user = $state<{ value: User | null }>({ value: null });
export const session = $state<{ value: UserSession | null }>({ value: null });
export const profile = $state<{ value: Profile | null }>({ value: null });
export const conversations = $state<{ value: Conversation[] }>({ value: [] });
export const activeConversation = $state<{ value: Conversation | null }>({ value: null });

// --- Unread badge helpers -------------------------------------------------
// unread_count lives on each Conversation. We mutate the array immutably so
// Svelte's reactivity picks up the change in the sidebar.

function patchConversation(id: string, patch: Partial<Conversation>): void {
  const i = conversations.value.findIndex((c) => c.conversation_id === id);
  if (i === -1) return;
  const next = conversations.value.slice();
  next[i] = { ...next[i], ...patch };
  conversations.value = next;
}

/** A new agent message arrived. Bump the badge unless that chat is open. */
export function bumpUnread(conversationId: string): void {
  if (activeConversation.value?.conversation_id === conversationId) return;
  const conv = conversations.value.find((c) => c.conversation_id === conversationId);
  if (!conv) return; // not one of ours (or list not loaded yet)
  patchConversation(conversationId, { unread_count: (conv.unread_count ?? 0) + 1 });
}

/** Conversation has been read — clear its badge. */
export function clearUnread(conversationId: string): void {
  const conv = conversations.value.find((c) => c.conversation_id === conversationId);
  if (!conv?.unread_count) return;
  patchConversation(conversationId, { unread_count: 0 });
}

/** Total across all conversations (for a future global indicator). */
export function totalUnread(): number {
  return conversations.value.reduce((n, c) => n + (c.unread_count ?? 0), 0);
}
