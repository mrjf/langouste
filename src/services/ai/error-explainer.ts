import { getAnthropicClient } from "./client.ts";
import { requireArray, requireString, toolInputObject } from "./tool-output.ts";
import { config } from "../../lib/config.ts";
import { testRegistry } from "../../lib/test-registry.ts";
import { buildErrorExplanationPrompt, ERROR_EXPLANATION_TOOL } from "./error-prompts.ts";
import type { LanguageCode, CefrLevel, TextError, ErrorExplanation } from "../../types/index.ts";

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

export async function explainErrors(input: ExplainErrorsInput): Promise<ExplainErrorsOutput> {
  if (config.stubAi) {
    const stub = testRegistry.getExplainResponse(input.text);
    const explanations: ErrorExplanation[] = (stub.explanations ?? []).map((e) => ({
      error: input.errors[e.error_index],
      corrected: e.corrected,
      explanations: e.explanations,
      rule: e.rule,
    }));
    return {
      corrected_message: stub.corrected_message,
      explanations,
      additional_errors: (stub.additional_errors ?? []).map((e) => ({
        start: e.start,
        end: e.end,
        text: e.text,
        corrected: e.corrected,
        kind: "grammar" as const,
        explanations: e.explanations,
        rule: e.rule,
      })),
    };
  }

  const client = getAnthropicClient();
  const prompt = buildErrorExplanationPrompt(input);

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    tools: [ERROR_EXPLANATION_TOOL],
    tool_choice: { type: "tool", name: "explain_errors" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Opus did not return structured output");
  }

  const raw = toolInputObject(toolUse.input, "explain_errors");
  const corrected_message = requireString(raw.corrected_message, "corrected_message");
  const rawExplanations = requireArray(raw.explanations, "explanations") as Array<{
    error_index: number;
    corrected: string;
    explanations: Record<string, string>;
    rule?: string;
  }>;
  const rawAdditionalErrors = requireArray(raw.additional_errors, "additional_errors") as Array<{
    start: number;
    end: number;
    text: string;
    corrected: string;
    kind: "grammar";
    explanations: Record<string, string>;
    rule?: string;
  }>;

  // Map the tool output back to our types
  const explanations: ErrorExplanation[] = rawExplanations.map((e) => ({
    error: input.errors[e.error_index],
    corrected: e.corrected,
    explanations: e.explanations,
    rule: e.rule,
  }));

  const additional_errors = rawAdditionalErrors.map((e) => ({
    start: e.start,
    end: e.end,
    text: e.text,
    corrected: e.corrected,
    kind: "grammar" as const,
    explanations: e.explanations,
    rule: e.rule,
  }));

  return { corrected_message, explanations, additional_errors };
}
