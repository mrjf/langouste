import { getAnthropicClient } from "./client.ts";
import { languageName } from "../../lib/languages.ts";
import type {
  VocabularyExtractionInput,
  VocabularyExtractionOutput,
} from "./types.ts";

const VOCABULARY_EXTRACTION_TOOL = {
  name: "extract_vocabulary" as const,
  description: "Extract new vocabulary, detect grammar gaps, and generate a learning challenge from a sent message.",
  input_schema: {
    type: "object" as const,
    properties: {
      new_vocabulary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "The word in target language" },
            translation: { type: "string", description: "Translation to the learner's primary base language" },
            context_sentence: { type: "string", description: "The sentence containing this word" },
            cefr_level: { type: ["string", "null"] as const, description: "Estimated CEFR level" },
          },
          required: ["term", "translation", "context_sentence", "cefr_level"],
        },
      },
      grammar_gaps_detected: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string", description: 'Grammar category, e.g. "verb:passé_composé"' },
            description: { type: "string", description: "Brief description of the gap" },
          },
          required: ["category", "description"],
        },
      },
      next_challenge: {
        type: "string",
        description: "Specific, encouraging suggestion for the next message",
      },
    },
    required: ["new_vocabulary", "grammar_gaps_detected", "next_challenge"],
  },
};

export async function extractVocabulary(
  input: VocabularyExtractionInput,
): Promise<VocabularyExtractionOutput> {
  const client = getAnthropicClient();
  const targetLang = languageName(input.language);
  const baseLang = languageName(input.base_languages[0] ?? "en");

  const context = input.conversation_context.length > 0
    ? input.conversation_context.join("\n")
    : "(start of conversation)";

  const intentSection = input.intent
    ? `\nThe sender described their intent as: "${input.intent}"\n`
    : "";

  const prompt = `You are a language learning assistant analyzing a message that was just sent in ${targetLang} by a learner at CEFR level ${input.cefr_level}.

## The message
"${input.text}"
${intentSection}
## Recent conversation
${context}

## Tasks

1. **Extract new vocabulary**: Identify words the sender used that they likely don't know well yet (based on CEFR level). For each word, provide the term, its translation to ${baseLang}, the sentence it appeared in, and estimated CEFR level.

2. **Detect grammar gaps**: If you notice grammar patterns the sender struggles with (from this message or the conversation context), categorize them (e.g., "verb:passé_composé", "gender:articles", "prepositions:à_vs_de"). Only include categories where actual issues are evident.

3. **Generate a challenge**: Suggest something specific for their next message. Prioritize practicing weak areas. Be encouraging. One sentence.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [VOCABULARY_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_vocabulary" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Sonnet did not return structured output for vocabulary extraction");
  }

  const result = toolUse.input as VocabularyExtractionOutput;

  return {
    new_vocabulary: result.new_vocabulary ?? [],
    grammar_gaps_detected: result.grammar_gaps_detected ?? [],
    next_challenge: result.next_challenge ?? "",
  };
}
