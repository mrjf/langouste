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
  profile?: { user_id: string; display_name: string } | null;
}

export interface AgentConnector {
  connector_id: string;
  name: string;
  type: "openclaw" | "claude" | "http";
  config: Record<string, unknown>;
}

export interface Conversation {
  conversation_id: string;
  created_by: string;
  agent_connector_id: string;
  agent_connector?: AgentConnector | null;
  created_at: string;
  members: ConversationMember[];
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
