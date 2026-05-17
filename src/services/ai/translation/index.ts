import { config } from "../../../lib/config.ts";
import type { TranslationProvider } from "./provider.ts";
import { ClaudeTranslationProvider } from "./claude-provider.ts";
import { GoogleTranslationProvider } from "./google-provider.ts";

export type { TranslationProvider } from "./provider.ts";
export { ClaudeTranslationProvider } from "./claude-provider.ts";
export { GoogleTranslationProvider } from "./google-provider.ts";

let _provider: TranslationProvider | null = null;

export function getTranslationProvider(): TranslationProvider {
  if (!_provider) {
    switch (config.translationProvider) {
      case "google-tllm":
        _provider = new GoogleTranslationProvider();
        break;
      case "claude":
        _provider = new ClaudeTranslationProvider();
        break;
      default:
        throw new Error(`Unknown translation provider: ${config.translationProvider}`);
    }
    console.log(`[Translation] Provider initialized: ${config.translationProvider}`);
  }
  return _provider;
}
