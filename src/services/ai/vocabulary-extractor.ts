import { getAnthropicClient } from "./client.ts";
import { config } from "../../lib/config.ts";
import { testRegistry } from "../../lib/test-registry.ts";
import { languageName } from "../../lib/languages.ts";
import { ALLOWED_GRAMMAR_CATEGORIES } from "../profile/grammar-ontology.ts";
import type { VocabularyExtractionInput, VocabularyExtractionOutput } from "./types.ts";

const VOCABULARY_EXTRACTION_TOOL = {
  name: "extract_vocabulary" as const,
  description:
    "Extract vocabulary, detect grammar gaps, and generate a learning challenge from language-learning text.",
  input_schema: {
    type: "object" as const,
    properties: {
      new_vocabulary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "The word in target language" },
            translation: {
              type: "string",
              description: "Translation to the learner's primary base language",
            },
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
            category: {
              type: "string",
              description:
                "Closed ontology category only; never invent general or ad-hoc categories.",
            },
            description: {
              type: "string",
              description:
                "Brief explanation of this specific production instance; not the category definition.",
            },
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
  if (config.stubAi) {
    const stub = testRegistry.getVocabResponse(input.text);
    return {
      new_vocabulary: (stub.new_vocabulary ?? []).map((item) => ({
        ...item,
        context_sentence: item.context_sentence ?? input.text,
        cefr_level: allowedCefrLevel(item.cefr_level),
      })),
      grammar_gaps_detected: stub.grammar_gaps_detected ?? [],
      next_challenge: stub.next_challenge ?? "",
    };
  }

  const client = getAnthropicClient();
  const targetLang = languageName(input.language);
  const baseLang = languageName(input.base_languages[0] ?? "en");

  const context =
    input.conversation_context.length > 0
      ? input.conversation_context.join("\n")
      : "(start of conversation)";

  const intentSection = input.intent
    ? `\nThe sender described their intent as: "${input.intent}"\n`
    : "";
  const allowedGrammarCategories = ALLOWED_GRAMMAR_CATEGORIES.join(", ");

  const prompt = `You are a language learning assistant analyzing text in ${targetLang} for a learner at CEFR level ${input.cefr_level}.

## The message
"${input.text}"
${intentSection}
## Recent conversation
${context}

## Tasks

1. **Extract new vocabulary**: Identify words or short lexical chunks present in the text that the learner likely doesn't know well yet (based on CEFR level). For each item, provide the term, its translation to ${baseLang}, the sentence it appeared in, and estimated CEFR level.

2. **Detect grammar gaps**: If the text is learner-produced and you notice grammar patterns the sender struggles with (from this message or the conversation context), use only one of these exact generic categories: ${allowedGrammarCategories}. The category must be generic, not a description of this one message. Put the message-specific explanation in the description field. Only include categories where actual issues are evident. If the issue is general communication, random keystrokes, no recognizable target-language output, low effort, or otherwise outside this closed ontology, return no grammar gap rather than inventing a category.

3. **Generate a challenge**: Suggest something specific for their next message. Prioritize practicing weak areas. Be encouraging. One sentence.

## Backtick convention
Any text inside backticks (\`like this\`) is a literal the user marked as not-to-be-translated — a proper noun, nickname, brand, code token, or similar. Do NOT extract it as vocabulary and do NOT treat it as a grammar gap. Ignore it entirely for learning purposes.`;

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

function allowedCefrLevel(
  value: string | null | undefined,
): VocabularyExtractionOutput["new_vocabulary"][number]["cefr_level"] {
  if (
    value === "A1" ||
    value === "A2" ||
    value === "B1" ||
    value === "B2" ||
    value === "C1" ||
    value === "C2"
  ) {
    return value;
  }
  return null;
}
