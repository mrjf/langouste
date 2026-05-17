import type {
  CefrLevel,
  Correction,
  LanguageCode,
  TextError,
  ErrorExplanation,
} from "../../types/index.ts";

// --- Legacy types (kept for backward compat during migration) ---

export interface ProcessMessageInput {
  raw_text: string;
  sender_base_language: LanguageCode;
  sender_target_language: LanguageCode;
  sender_cefr_level: CefrLevel;
  recipient_base_language: LanguageCode;
  recipient_cefr_level: CefrLevel | null;
  recent_grammar_gaps: string[];
  recent_vocabulary: string[];
  conversation_context: string[];
}

export interface ProcessMessageOutput {
  healed_text: string;
  translation: string | null;
  corrections: Correction[];
  new_vocabulary: Array<{
    term: string;
    translation: string;
    context_sentence: string;
    cefr_level: CefrLevel | null;
  }>;
  grammar_gaps_detected: Array<{
    category: string;
    description: string;
  }>;
  next_challenge: string;
}

// --- New types for the split pipeline ---

export interface ExplainErrorsInput {
  text: string;
  errors: TextError[];
  target_language: LanguageCode;
  base_languages: LanguageCode[];
  cefr_level: CefrLevel;
  intent?: string;
  conversation_context: string[];
}

export interface ExplainErrorsOutput {
  corrected_message: string;
  explanations: ErrorExplanation[];
  additional_errors: Array<
    TextError & { corrected: string; explanations: Record<LanguageCode, string> }
  >;
}

export interface VocabularyExtractionInput {
  text: string;
  language: LanguageCode;
  base_languages: LanguageCode[];
  cefr_level: CefrLevel;
  intent?: string;
  conversation_context: string[];
}

export interface VocabularyExtractionOutput {
  new_vocabulary: Array<{
    term: string;
    translation: string;
    context_sentence: string;
    cefr_level: CefrLevel | null;
  }>;
  grammar_gaps_detected: Array<{
    category: string;
    description: string;
  }>;
  next_challenge: string;
}
