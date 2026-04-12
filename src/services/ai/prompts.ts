import type { ProcessMessageInput } from "./types.ts";

export function buildMessageProcessingPrompt(input: ProcessMessageInput): string {
  const grammarGapsList = input.recent_grammar_gaps.length > 0
    ? input.recent_grammar_gaps.map((g) => `  - ${g}`).join("\n")
    : "  (none tracked yet)";

  const vocabList = input.recent_vocabulary.length > 0
    ? input.recent_vocabulary.map((v) => `  - ${v}`).join("\n")
    : "  (none due for review)";

  const context = input.conversation_context.length > 0
    ? input.conversation_context.join("\n")
    : "(start of conversation)";

  const recipientLevel = input.recipient_cefr_level
    ? `Learning ${input.sender_target_language} at CEFR level ${input.recipient_cefr_level}`
    : `Base language: ${input.recipient_base_language}`;

  return `You are a language learning assistant mediating a real conversation between two people. Your job is to help the sender communicate effectively while learning.

## Sender Profile
- Base language: ${input.sender_base_language}
- Learning: ${input.sender_target_language} at CEFR level ${input.sender_cefr_level}
- Known grammar weaknesses:
${grammarGapsList}
- Vocabulary due for review:
${vocabList}

## Recipient Profile
- Base language: ${input.recipient_base_language}
- ${recipientLevel}

## Recent Conversation
${context}

## The sender wrote:
"${input.raw_text}"

## Your Tasks

1. **Heal the message**: Rewrite the sender's message as correct, natural ${input.sender_target_language}. Preserve their meaning, tone, and intent. If they used ${input.sender_base_language} words where they didn't know the ${input.sender_target_language}, translate those parts. Keep it at a natural level — don't oversimplify or overcomplicate.

2. **Translate for recipient**: If the recipient is not a native speaker of ${input.sender_target_language} and their level is below B2, provide a helpful translation into ${input.recipient_base_language}. If they're B2+ or a native speaker, set translation to null.

3. **Identify corrections**: List every error or non-native usage in the original message. For each, give the original text, the corrected form, an explanation in ${input.sender_base_language} (brief, friendly, not patronizing), and a grammar category.

4. **Extract new vocabulary**: Identify words in ${input.sender_target_language} from your healed text that the sender likely doesn't know yet (based on their CEFR level). Include the term, its translation to ${input.sender_base_language}, the sentence it appeared in, and estimated CEFR level of the word.

5. **Detect grammar gaps**: If the sender made grammar errors, categorize them (e.g., "verb:passé_composé", "gender:articles", "prepositions:à_vs_de"). Only include categories where actual errors occurred.

6. **Generate a challenge**: Suggest something specific to try in their next message. Prioritize items from their vocabulary/grammar review list. Be encouraging and specific (e.g., "Try describing what you did yesterday using the passé composé" or "Can you use the word 'cependant' in your reply?"). Keep it to one sentence.`;
}

export const MESSAGE_PROCESSING_TOOL = {
  name: "process_message" as const,
  description:
    "Process a chat message: heal it, analyze errors, translate if needed, and generate a learning challenge.",
  input_schema: {
    type: "object" as const,
    properties: {
      healed_text: {
        type: "string",
        description:
          "The sender's message corrected into proper target language",
      },
      translation: {
        type: ["string", "null"] as const,
        description:
          "Translation for recipient if needed, null if recipient is B2+ or native",
      },
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            original: {
              type: "string",
              description: "The incorrect text from the sender",
            },
            corrected: {
              type: "string",
              description: "The corrected version",
            },
            explanation: {
              type: "string",
              description: "Brief explanation in sender's base language",
            },
            category: {
              type: "string",
              description:
                'Grammar/error category, e.g. "grammar:prepositions", "vocabulary", "spelling"',
            },
          },
          required: ["original", "corrected", "explanation", "category"],
        },
        description: "List of corrections found in the original message",
      },
      new_vocabulary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "The word in target language" },
            translation: {
              type: "string",
              description: "Translation to sender's base language",
            },
            context_sentence: {
              type: "string",
              description: "The sentence from healed_text containing this word",
            },
            cefr_level: {
              type: ["string", "null"] as const,
              description: "Estimated CEFR level of this vocabulary item",
            },
          },
          required: ["term", "translation", "context_sentence", "cefr_level"],
        },
        description: "New vocabulary items the sender should learn",
      },
      grammar_gaps_detected: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                'Grammar category, e.g. "verb:passé_composé", "gender:articles"',
            },
            description: {
              type: "string",
              description: "Brief description of the grammar gap",
            },
          },
          required: ["category", "description"],
        },
        description: "Grammar categories where errors were detected",
      },
      next_challenge: {
        type: "string",
        description:
          "Specific, encouraging suggestion for what to try in the next message",
      },
    },
    required: [
      "healed_text",
      "translation",
      "corrections",
      "new_vocabulary",
      "grammar_gaps_detected",
      "next_challenge",
    ],
  },
};
