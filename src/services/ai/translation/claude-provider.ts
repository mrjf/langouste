import { getAnthropicClient } from "../client.ts";
import { languageName } from "../../../lib/languages.ts";
import type { TranslationProvider } from "./provider.ts";

/**
 * Translation provider using Claude (Haiku) via the Anthropic SDK.
 */
export class ClaudeTranslationProvider implements TranslationProvider {
  async translateTexts(
    texts: string[],
    targetLanguage: string,
    context?: string,
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    const client = getAnthropicClient();
    const numbered = texts.map((t, i) => `[${i}] ${t}`).join("\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [
        {
          name: "translations",
          description: "Return the translated texts",
          input_schema: {
            type: "object" as const,
            properties: {
              translated: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "Translated texts in the same order as input",
              },
            },
            required: ["translated"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "translations" },
      messages: [
        {
          role: "user",
          content: `Translate each text into ${languageName(targetLanguage)} (language code: ${targetLanguage}). These are chat messages in a language learning app. Translate accurately and naturally, matching the exact register of the original. "Bonjour" = "Hello" (not "hey"). "Salut" = "Hi". Do not shift formality up or down. Return exactly ${texts.length} translations in the same order.

IMPORTANT — backtick convention: Any text inside backticks (\`like this\`) is a literal the user marked as not-to-be-translated (proper noun, nickname, brand, code token). Keep it byte-identical in the output, including the surrounding backticks. Do not translate, transliterate, reorder, or alter it.

${numbered}`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("AI did not return structured translations");
    }

    const result = toolUse.input as { translated: string[] };
    return result.translated;
  }
}
