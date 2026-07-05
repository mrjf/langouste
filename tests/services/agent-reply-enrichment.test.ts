import "./_db-harness.ts"; // side-effect: sets sqlite env + shared data dir (must be first)
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ConversationMember, Message } from "../../src/types/index.ts";

// Regression test for the enrichment-failure-isolation fix in
// src/routes/api/messages.ts. processAgentReply persists the agent's reply and
// THEN runs enrichment (translation / Filo doc / vocab tracking). A failure in
// enrichment must not overwrite the already-persisted reply with an
// "Agent error" message. We force ensureTranslations to throw and assert the
// reply text survives intact.

const STUB_REPLY = "Jó napot! Hogy vagy?";

beforeAll(async () => {
  // Force the first enrichment step to fail. The real module only exports
  // translateTexts + ensureTranslations, so we spread the rest and override.
  const realTranslator = await import("../../src/services/ai/translator.ts");
  mock.module("../../src/services/ai/translator.ts", () => ({
    ...realTranslator,
    ensureTranslations: async () => {
      throw new Error("forced enrichment failure");
    },
  }));

  // Provide a fake agent so the test doesn't depend on process-wide test mode
  // (config.testMode is a singleton that other test files may have locked to
  // false). The connector row is still real; only the connection is faked.
  mock.module("../../src/services/agents/factory.ts", () => ({
    getAgentConnection: () => ({
      async sendMessage() {
        return STUB_REPLY;
      },
      getStatus() {
        return { status: "connected", detail: "fake", since: new Date(), failedAttempts: 0 };
      },
      onStatusChange() {},
      disconnect() {},
    }),
    disconnectAgent() {},
  }));
});

afterAll(() => {
  mock.restore();
});

describe("agent reply enrichment", () => {
  test("a failed enrichment step does not overwrite the persisted reply", async () => {
    const { adminDb } = await import("../../src/lib/db/index.ts");
    const { signup } = await import("../../src/lib/auth/local.ts");
    const { createConversation } = await import("../../src/services/database/conversations.ts");
    const { addMember, getMember } = await import("../../src/services/database/members.ts");
    const { getConnector } = await import("../../src/services/database/agent-connectors.ts");
    const { processAgentReply } = await import("../../src/routes/api/messages.ts");

    const session = await signup("enrich@test", "password-123456");
    const userId = session.user.id;
    await adminDb().insert("profiles", {
      user_id: userId,
      display_name: "enrich",
      base_language: "en",
      learning_languages: [],
    });

    const connectorRow = await adminDb().insert<{ connector_id: string }>("agent_connectors", {
      name: "stub-connector",
      type: "stub",
      config: {},
      created_by: userId,
    });
    const conversation = await createConversation(adminDb(), userId, connectorRow.connector_id);
    const conversationId = conversation.conversation_id;
    await addMember(adminDb(), {
      conversation_id: conversationId,
      user_id: userId,
      target_languages: [{ lang: "hu", cefr_level: "A1" }],
      base_languages: ["en"],
    });

    const senderMember = (await getMember(adminDb(), conversationId, userId)) as ConversationMember;
    const connector = (await getConnector(adminDb(), connectorRow.connector_id))!;

    const userMessage = await adminDb().insert<Message>("messages", {
      conversation_id: conversationId,
      sender_id: userId,
      raw_text: "jó napot",
      healed_text: "jó napot",
      language: "hu",
      translation: null,
      translations: { hu: "jó napot" },
      corrections: [],
      next_challenge: null,
    });
    const agentMessage = await adminDb().insert<Message>("messages", {
      conversation_id: conversationId,
      sender_id: userId,
      raw_text: "",
      healed_text: "",
      language: "hu",
      translation: null,
      translations: {},
      corrections: [],
      next_challenge: null,
      is_agent: true,
      filo_doc: null,
    });

    // ensureTranslations (mocked) throws inside processAgentReply. With the fix,
    // the reply persisted before enrichment survives; without it, the outer
    // catch would overwrite it with "Agent error: ...".
    await processAgentReply({
      connector,
      conversationId,
      userId,
      senderMember,
      userMessage,
      agentMessage,
      inputText: "jó napot",
      inputLanguage: "hu",
    });

    const row = await adminDb().selectOne<Message>("messages", {
      filters: [{ op: "eq", column: "message_id", value: agentMessage.message_id }],
    });
    expect(row).not.toBeNull();
    expect(row?.raw_text).toBe(STUB_REPLY);
    expect(row?.raw_text.startsWith("Agent error")).toBe(false);
  });
});
