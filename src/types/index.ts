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
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  target_language: LanguageCode;
  base_language: LanguageCode;
  joined_at: string;
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
  translation: string | null;
  corrections: Correction[];
  next_challenge: string | null;
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

export interface VocabularyItem extends SpacedRepetitionFields {
  vocab_id: string;
  user_id: string;
  language: LanguageCode;
  term: string;
  translation: string;
  context_sentence: string | null;
  cefr_level: CefrLevel | null;
  created_at: string;
}

export interface GrammarGap extends SpacedRepetitionFields {
  gap_id: string;
  user_id: string;
  language: LanguageCode;
  category: string;
  description: string;
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
