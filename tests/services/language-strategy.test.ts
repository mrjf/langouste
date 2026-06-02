import { describe, expect, test } from "bun:test";
import type { ConversationMember, Message } from "../../src/types/index.ts";

describe("agent language strategy", () => {
  test("target-first asks the agent for the target language directly", async () => {
    process.env.ANTHROPIC_API_KEY ||= "test-key";
    const { planAgentLanguageExchange, seedAgentResponseTranslations } = await import(
      "../../src/services/messages/language-strategy.ts"
    );

    const member: ConversationMember = {
      conversation_id: "conversation-1",
      user_id: "user-1",
      target_languages: [{ lang: "hu", cefr_level: "A1" }],
      base_languages: ["en"],
      joined_at: new Date().toISOString(),
      last_read_at: new Date().toISOString(),
    };
    const historyMessage = {
      message_id: "message-1",
      conversation_id: "conversation-1",
      sender_id: "agent",
      raw_text: "Good morning.",
      healed_text: "Good morning.",
      language: "en",
      translation: null,
      translations: { hu: "Jó reggelt." },
      transliterations: {},
      phonetics: {},
      corrections: [],
      next_challenge: null,
      is_agent: true,
      created_at: new Date().toISOString(),
    } satisfies Message;

    const plan = await planAgentLanguageExchange(
      {
        text: "jó napot",
        language: "hu",
        userId: "user-1",
        member,
        historyMessages: [historyMessage],
      },
      "target-first",
    );

    expect(plan.strategy).toBe("target-first");
    expect(plan.responseLanguage).toBe("hu");
    expect(plan.requiredLanguages).toEqual(["hu", "en"]);
    expect(plan.input).toContain("Reply only in Hungarian (hu).");
    expect(plan.input).toContain("jó napot");
    expect(plan.history).toEqual([{ role: "assistant", content: "Jó reggelt." }]);
    expect(seedAgentResponseTranslations("Szia!", plan.responseLanguage, "target-first")).toEqual({
      hu: "Szia!",
    });
  });
});
