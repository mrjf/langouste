import { getAnthropicClient } from "./client.ts";
import {
  buildMessageProcessingPrompt,
  MESSAGE_PROCESSING_TOOL,
} from "./prompts.ts";
import type { ProcessMessageInput, ProcessMessageOutput } from "./types.ts";

export async function processMessage(
  input: ProcessMessageInput,
): Promise<ProcessMessageOutput> {
  const client = getAnthropicClient();
  const prompt = buildMessageProcessingPrompt(input);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools: [MESSAGE_PROCESSING_TOOL],
    tool_choice: { type: "tool", name: "process_message" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract the tool use result
  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return structured output");
  }

  const result = toolUse.input as ProcessMessageOutput;

  return {
    healed_text: result.healed_text,
    translation: result.translation ?? null,
    corrections: result.corrections ?? [],
    new_vocabulary: result.new_vocabulary ?? [],
    grammar_gaps_detected: result.grammar_gaps_detected ?? [],
    next_challenge: result.next_challenge,
  };
}
