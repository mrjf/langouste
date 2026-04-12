import type {
  CefrLevel,
  Correction,
  LanguageCode,
} from "../../types/index.ts";

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
