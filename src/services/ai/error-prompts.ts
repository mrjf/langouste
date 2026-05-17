import type { LanguageCode, CefrLevel, TextError } from "../../types/index.ts";
import { languageName } from "../../lib/languages.ts";

export interface ExplainErrorsPromptInput {
  text: string;
  errors: TextError[];
  target_language: LanguageCode;
  base_languages: LanguageCode[];
  cefr_level: CefrLevel;
  intent?: string;
  conversation_context: string[];
}

export function buildErrorExplanationPrompt(input: ExplainErrorsPromptInput): string {
  const targetLang = languageName(input.target_language);
  const baseLangs = input.base_languages.map(languageName).join(", ");
  const baseLangCodes = input.base_languages.map((l) => `"${l}"`).join(", ");

  const errorsList = input.errors
    .map((e, i) => `  ${i}. "${e.text}" (position ${e.start}-${e.end}, ${e.kind})`)
    .join("\n");

  const context =
    input.conversation_context.length > 0
      ? input.conversation_context.join("\n")
      : "(start of conversation)";

  const intentSection = input.intent
    ? `\n## What the sender is trying to say\n"${input.intent}"\n`
    : "";

  return `You are a concise language tutor helping someone learn ${targetLang}. CEFR level: ${input.cefr_level}.

## RULES
- First, provide the corrected_message: the full message rewritten correctly in ${targetLang}. This is the target the learner must match.
- For each error, provide the **corrected** form (what the text should be) and a brief explanation.
- Be **terse**: 1-2 sentences per error. Use markdown bold for key words.
- No preamble, no encouragement, no emoji. Just the correction and the reason.
- Casual texting is fine — don't flag informal register or missing caps.
- **Backticked spans are literals.** Any run of text inside backticks (\`like this\`) is a proper noun, nickname, code token, or other word the learner has explicitly marked as not-to-be-translated. Never flag them as errors, never "correct" them, and keep them byte-identical (including the surrounding backticks) in corrected_message.

## Learner's message in ${targetLang}
"${input.text}"

## Errors detected by spell-checker
${errorsList}

## Provide explanations in these languages: ${baseLangs} (codes: ${baseLangCodes})
For each error, provide an explanation in EACH of the base languages listed above.

## Also check for grammar errors
The spell-checker only catches spelling. If you notice grammar errors (wrong article, verb conjugation, agreement, preposition), report them as additional_errors with their character positions.
${intentSection}
## Recent conversation for context
${context}`;
}

export const ERROR_EXPLANATION_TOOL = {
  name: "explain_errors" as const,
  description: "Explain language errors to help the learner understand what's wrong and why",
  input_schema: {
    type: "object" as const,
    properties: {
      corrected_message: {
        type: "string",
        description:
          "The full message rewritten correctly in the target language. This is what the learner's text should match when all errors are fixed.",
      },
      explanations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            error_index: {
              type: "number",
              description: "Index into the errors array from the input",
            },
            corrected: {
              type: "string",
              description:
                "The correct form of the erroneous text (what the user should type instead)",
            },
            explanations: {
              type: "object",
              description:
                'Explanation in each base language, keyed by language code (e.g. {"en": "...", "es": "..."})',
              additionalProperties: { type: "string" },
            },
            rule: {
              type: "string",
              description: "Grammar rule identifier if applicable (e.g. 'article-noun agreement')",
            },
          },
          required: ["error_index", "corrected", "explanations"],
        },
        description: "Explanations for each spell-check error",
      },
      additional_errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number", description: "Character offset start" },
            end: { type: "number", description: "Character offset end (exclusive)" },
            text: { type: "string", description: "The erroneous text" },
            corrected: { type: "string", description: "The correct form" },
            kind: {
              type: "string",
              enum: ["grammar"],
              description: "Always 'grammar' for LLM-detected errors",
            },
            explanations: {
              type: "object",
              description: "Explanation in each base language, keyed by language code",
              additionalProperties: { type: "string" },
            },
          },
          required: ["start", "end", "text", "corrected", "kind", "explanations"],
        },
        description: "Grammar errors the spell-checker missed",
      },
    },
    required: ["corrected_message", "explanations", "additional_errors"],
  },
};
