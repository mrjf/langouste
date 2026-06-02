// CEFR levels
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

// ISO 639-1 language codes
export type LanguageCode = string; // e.g., "en", "fr", "hu", "es"

export interface LearningLanguage {
  lang: LanguageCode;
  cefr_level: CefrLevel;
  assessed_at: string;
}

export interface Profile {
  user_id: string;
  display_name: string;
  base_language: LanguageCode;
  learning_languages: LearningLanguage[];
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  conversation_id: string;
  created_by: string;
  agent_connector_id: string;
  created_at: string;
}

export type AgentType = "openclaw" | "claude" | "claude-code" | "http" | "stub";

export interface AgentConnector {
  connector_id: string;
  name: string;
  type: AgentType;
  config: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  target_languages: Array<{ lang: LanguageCode; cefr_level: CefrLevel }>;
  base_languages: LanguageCode[];
  joined_at: string;
  /** When this member last read the conversation. Drives unread badges. */
  last_read_at: string;
}

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  category: string; // e.g., "grammar:prepositions", "vocabulary", "gender:articles"
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  raw_text: string;
  healed_text: string;
  language: LanguageCode | null;
  translation: string | null;
  translations: Record<string, string>;
  transliterations: Record<string, string>; // key: "sourceLang→targetLang" e.g. "ar→en"
  phonetics: Record<string, string>; // key: "system:lang" e.g. "ipa:fr"
  corrections: Correction[];
  next_challenge: string | null;
  is_agent: boolean;
  created_at: string;
}

// Spaced repetition fields shared by vocabulary and grammar_gaps
export interface SpacedRepetitionFields {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string | null;
}

export interface ConceptSrsState {
  concept_state_id: string;
  user_id: string;
  language: LanguageCode;
  concept_id: string;
  item_type: "vocabulary" | "grammar" | "concept";
  label: string;
  difficulty: number;
  stability: number;
  retrievability: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  next_review_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FSRSConfig {
  config_id: string | null;
  user_id: string;
  language: LanguageCode;
  parameters: number[];
  request_retention: number;
  maximum_interval_days: number;
  failure_review_delay_minutes: number;
  quality_weights: Record<string, number | null>;
  created_at: string | null;
  updated_at: string | null;
}

export interface VocabularyItem extends SpacedRepetitionFields {
  vocab_id: string;
  user_id: string;
  language: LanguageCode;
  term: string;
  translation: string;
  context_sentence: string | null;
  cefr_level: CefrLevel | null;
  concept_id: string | null;
  created_at: string;
}

export interface GrammarGap extends SpacedRepetitionFields {
  gap_id: string;
  user_id: string;
  language: LanguageCode;
  category: string;
  description: string;
  concept_id: string | null;
  error_count: number;
  last_error_at: string;
  created_at: string;
}

export interface Assessment {
  assessment_id: string;
  user_id: string;
  language: LanguageCode;
  cefr_level: CefrLevel;
  assessed_at: string;
  evidence: Record<string, unknown> | null;
}

// Spell-check pipeline types

export type ErrorKind = "spelling" | "grammar";

export interface TextError {
  start: number;
  end: number;
  text: string;
  kind: ErrorKind;
  suggestions?: string[];
}

export interface ErrorExplanation {
  error: TextError;
  corrected: string;
  explanations: Record<LanguageCode, string>;
  rule?: string;
}

export interface SelfCorrectedSpan {
  original: string;
  corrected: string;
  kind: ErrorKind;
  category?: string;
  explanation?: string;
}
