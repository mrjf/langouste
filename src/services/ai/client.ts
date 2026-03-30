import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../lib/config.ts";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}
