import { getAnthropicClient } from "./client.ts";
import { config } from "../../lib/config.ts";
import { testRegistry } from "../../lib/test-registry.ts";
import {
  buildErrorExplanationPrompt,
  ERROR_EXPLANATION_TOOL,
  type ExplainErrorsPromptInput,
} from "./error-prompts.ts";
import type {
  LanguageCode,
  CefrLevel,
  TextError,
  ErrorExplanation,
} from "../../types/index.ts";

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
  additional_errors: Array<TextError & { corrected: string; explanations: Record<LanguageCode, string> }>;
}

export async function explainErrors(
  input: ExplainErrorsInput,
): Promise<ExplainErrorsOutput> {
  if (config.stubAi) {
    const stub = testRegistry.getExplainResponse(input.text);
    const explanations: ErrorExplanation[] = (stub.explanations ?? []).map((e) => ({
      error: input.errors[e.error_index],
      corrected: e.corrected,
      explanations: e.explanations,
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

  const result = toolUse.input as {
    corrected_message: string;
    explanations: Array<{
      error_index: number;
      corrected: string;
      explanations: Record<string, string>;
      rule?: string;
    }>;
    additional_errors: Array<{
      start: number;
      end: number;
      text: string;
      corrected: string;
      kind: "grammar";
      explanations: Record<string, string>;
    }>;
  };

  // Map the tool output back to our types
  const explanations: ErrorExplanation[] = (result.explanations ?? []).map((e) => ({
    error: input.errors[e.error_index],
    corrected: e.corrected,
    explanations: e.explanations,
  }));

  const additional_errors = (result.additional_errors ?? []).map((e) => ({
    start: e.start,
    end: e.end,
    text: e.text,
    corrected: e.corrected,
    kind: "grammar" as const,
    explanations: e.explanations,
  }));

  return { corrected_message: result.corrected_message, explanations, additional_errors };
}
