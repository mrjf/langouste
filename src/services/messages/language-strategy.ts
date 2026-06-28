import { config } from "../../lib/config.ts";
import { languageName } from "../../lib/languages.ts";
import type { ConversationMember, Message } from "../../types/index.ts";
import { translateTexts } from "../ai/translator.ts";

export type AgentLanguageStrategyName = "target-first" | "english-mediated";

export interface AgentLanguagePlan {
  strategy: AgentLanguageStrategyName;
  input: string;
  history: Array<{ role: string; content: string }>;
  responseLanguage: string;
  requiredLanguages: string[];
}

export interface AgentLanguagePlanInput {
  text: string;
  language: string;
  userId: string;
  member: ConversationMember;
  historyMessages: Message[];
}

interface AgentLanguageStrategy {
  readonly name: AgentLanguageStrategyName;
  plan(input: AgentLanguagePlanInput): Promise<AgentLanguagePlan>;
  seedTranslations(response: string, responseLanguage: string): Record<string, string>;
}

export async function planAgentLanguageExchange(
  input: AgentLanguagePlanInput,
  strategyName: AgentLanguageStrategyName = config.agentLanguageStrategy,
): Promise<AgentLanguagePlan> {
  const strategy = getAgentLanguageStrategy(strategyName);
  return strategy.plan(input);
}

export function seedAgentResponseTranslations(
  response: string,
  responseLanguage: string,
  strategyName: AgentLanguageStrategyName = config.agentLanguageStrategy,
): Record<string, string> {
  return getAgentLanguageStrategy(strategyName).seedTranslations(response, responseLanguage);
}

function getAgentLanguageStrategy(name: AgentLanguageStrategyName): AgentLanguageStrategy {
  switch (name) {
    case "target-first":
      return TARGET_FIRST_STRATEGY;
    case "english-mediated":
      return ENGLISH_MEDIATED_STRATEGY;
  }
}

const TARGET_FIRST_STRATEGY: AgentLanguageStrategy = {
  name: "target-first",
  async plan(input) {
    const targetLanguage = input.language || input.member.target_languages[0]?.lang || "en";
    return {
      strategy: "target-first",
      input: targetLanguagePrompt(input.text, targetLanguage),
      history: input.historyMessages.map((message) => ({
        role: message.sender_id === input.userId ? "user" : "assistant",
        content: visibleTextForLanguage(message, targetLanguage),
      })),
      responseLanguage: targetLanguage,
      requiredLanguages: memberLanguages(input.member),
    };
  },
  seedTranslations(response, responseLanguage) {
    return response ? { [responseLanguage]: response } : {};
  },
};

const ENGLISH_MEDIATED_STRATEGY: AgentLanguageStrategy = {
  name: "english-mediated",
  async plan(input) {
    const [englishText] = await translateTexts([input.text], "en");
    return {
      strategy: "english-mediated",
      input: englishText,
      history: input.historyMessages.map((message) => ({
        role: message.sender_id === input.userId ? "user" : "assistant",
        content: message.translations?.en ?? message.healed_text,
      })),
      responseLanguage: "en",
      requiredLanguages: memberLanguages(input.member),
    };
  },
  seedTranslations(response, _responseLanguage): Record<string, string> {
    if (!response) return {};
    return { en: response };
  },
};

function targetLanguagePrompt(text: string, targetLanguage: string): string {
  const name = languageName(targetLanguage);
  return [
    `Reply only in ${name} (${targetLanguage}).`,
    "Keep the reply short and conversational.",
    "If the user wraps text in backticks, keep those spans byte-identical.",
    "",
    text,
  ].join("\n");
}

function memberLanguages(member: ConversationMember): string[] {
  return [
    ...new Set([...member.target_languages.map((target) => target.lang), ...member.base_languages]),
  ];
}

function visibleTextForLanguage(message: Message, language: string): string {
  if (message.language === language) return message.healed_text;
  return message.translations?.[language] ?? message.healed_text;
}
