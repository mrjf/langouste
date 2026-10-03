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
   *  client-side when the conversation is opened / marked read. */
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
  transliterations?: Record<string, string>;
  corrections: Correction[];
  next_challenge: string | null;
  is_agent?: boolean;
  filo_doc?: FiloDocumentJson | null;
  created_at: string;
  _pending?: boolean;
}

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  category: string;
}

export interface FiloAnnotationJson {
  id: string;
  tierId: string;
  kind: string;
  start: number;
  end: number;
  payload: Record<string, unknown>;
  source?: string;
  sourceInfo?: FiloSourceJson;
  confidence?: number;
}

export interface FiloTierJson {
  id: string;
  kind: string;
  description?: string;
  source?: string;
  sourceInfo?: FiloSourceJson;
  metadata?: Record<string, unknown>;
  annotations: FiloAnnotationJson[];
}

export interface FiloSourceJson {
  id: string;
  kind: string;
  label: string;
  module?: string;
  provider?: string;
  version?: string;
  url?: string;
  generatedAt?: string;
  parentSourceIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface FiloDocumentJson {
  id: string;
  text: string;
  byteLength: number;
  metadata: Record<string, unknown>;
  tiers: FiloTierJson[];
}

// User-scoped reactive state. Per-conversation state (messages, draft,
// review, working, unread, message refresh) lives on the Chat model in
// chat.svelte.ts — see ChatStore. These three are the only truly global,
// not-conversation-scoped pieces.
export const user = $state<{ value: User | null }>({ value: null });
export const session = $state<{ value: UserSession | null }>({ value: null });
export const profile = $state<{ value: Profile | null }>({ value: null });
