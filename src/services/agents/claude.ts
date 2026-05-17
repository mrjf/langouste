import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../lib/config.ts";
import type {
  AgentConnection,
  AgentStatusInfo,
  AgentStatusListener,
  ClaudeConfig,
} from "./types.ts";

export class ClaudeAgent implements AgentConnection {
  private client: Anthropic;
  private model: string;
  private systemPrompt: string;

  getStatus(): AgentStatusInfo {
    return { status: "connected", since: new Date(), failedAttempts: 0 };
  }

  onStatusChange(_listener: AgentStatusListener): void {
    // Always connected — no status changes to report
  }

  constructor(agentConfig: ClaudeConfig) {
    this.client = new Anthropic({
      apiKey: agentConfig.api_key || config.anthropicApiKey,
    });
    this.model = agentConfig.model || "claude-sonnet-4-6";
    this.systemPrompt =
      agentConfig.system_prompt ||
      "You are a friendly chat partner in a language learning app. Keep responses short and conversational — 2-3 sentences max. Ask follow-up questions to keep the conversation going. Don't lecture, don't use bullet points, don't give lists. Talk like a friend texting. Any text the user wraps in backticks (`like this`) is a literal — a name, nickname, or term they don't want translated. Keep those spans byte-identical (including the backticks) in your reply, and don't comment on them unless the user asks.";
  }

  async sendMessage(
    text: string,
    conversationHistory: Array<{ role: string; content: string }> = [],
  ): Promise<string> {
    const messages = [
      ...conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: text },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }

  disconnect() {
    // No persistent connection to clean up
  }
}
