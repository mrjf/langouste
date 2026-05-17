import { getAnthropicClient } from "../client.ts";
import { languageName } from "../../../lib/languages.ts";
import type { TranslationProvider } from "./provider.ts";

// Targets where Claude's `array of strings` tool schema fails reliably (it
// returns a JSON-stringified array instead of a real array). For these we
// skip the batch attempt and go straight to per-text. Add languages here as
// we observe them — the batch path is still ~4× faster when it works.
const BATCH_BLOCKLIST = new Set(["hu"]);

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

    if (BATCH_BLOCKLIST.has(targetLanguage)) {
      return Promise.all(texts.map((t) => this.translateOne(t, targetLanguage, context)));
    }

    try {
      return await this.translateBatch(texts, targetLanguage, context);
    } catch (err) {
      // Batch occasionally returns a JSON-string-wrapped array instead of a
      // real array (a Claude tool_use quirk on longer outputs). Fall back to
      // single-string calls — robust because the schema is `{translation:
      // string}` rather than an array.
      console.warn(
        `[Translation] [Claude] batch of ${texts.length} failed (${(err as Error).message.slice(0, 120)}); falling back to per-text single-string`,
      );
      return Promise.all(texts.map((t) => this.translateOne(t, targetLanguage, context)));
    }
  }

  private async translateOne(
    text: string,
    targetLanguage: string,
    _context?: string,
  ): Promise<string> {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [
        {
          name: "translation",
          description: "Return the translated text",
          input_schema: {
            type: "object" as const,
            properties: {
              translation: {
                type: "string" as const,
                description: "The translated text",
              },
            },
            required: ["translation"],
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: "translation" },
      messages: [
        {
          role: "user",
          content: `Translate this text into ${languageName(targetLanguage)} (language code: ${targetLanguage}). Translate accurately and naturally, matching the exact register of the original. Do not shift formality up or down. Keep any text in backticks (\`like this\`) byte-identical.\n\n${text}`,
        },
      ],
    });
    const tool = response.content.find((b) => b.type === "tool_use");
    if (!tool || tool.type !== "tool_use") {
      throw new Error("Translation tool_use missing");
    }
    const out = (tool.input as { translation?: unknown }).translation;
    if (typeof out !== "string") {
      throw new Error(`translation field is not a string (got ${typeof out})`);
    }
    return out;
  }

  private async translateBatch(
    texts: string[],
    targetLanguage: string,
    _context?: string,
  ): Promise<string[]> {
    const client = getAnthropicClient();
    const numbered = texts.map((t, i) => `[${i}] ${t}`).join("\n");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
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

    const result = toolUse.input as { translated?: unknown };
    let translated = result.translated;

    // Claude occasionally serialises the array as a JSON string inside the
    // tool input (e.g. {"translated": "[\"a\", \"b\"]"}) instead of a real
    // array. Recover by parsing.
    if (typeof translated === "string") {
      try {
        const parsed = JSON.parse(translated);
        if (Array.isArray(parsed)) translated = parsed;
      } catch {
        // fall through to error below
      }
    }

    if (!Array.isArray(translated)) {
      const preview =
        typeof result.translated === "string"
          ? `"${result.translated.slice(0, 200)}"`
          : JSON.stringify(result).slice(0, 200);
      throw new Error(
        `AI tool_use missing 'translated' array (got ${typeof result.translated}); stop_reason=${response.stop_reason}; preview=${preview}`,
      );
    }
    if (translated.length !== texts.length) {
      throw new Error(`AI returned ${translated.length} translations for ${texts.length} inputs`);
    }
    return translated.map((t) => String(t ?? ""));
  }
}
