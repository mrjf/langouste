import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getMessages, getRecentMessageTexts, insertMessage } from "../../services/database/messages.ts";
import { getMember } from "../../services/database/members.ts";
import { getConversation } from "../../services/database/conversations.ts";
import { getConnector } from "../../services/database/agent-connectors.ts";
import { checkSpelling } from "../../services/spellcheck/checker.ts";
import { detectLanguage } from "../../services/spellcheck/detector.ts";
import { explainErrors } from "../../services/ai/error-explainer.ts";
import { extractVocabulary } from "../../services/ai/vocabulary-extractor.ts";
import { ensureTranslations, translateTexts } from "../../services/ai/translator.ts";
import { ensureTransliterations } from "../../services/ai/transliterator.ts";
import { ensurePhonetics } from "../../services/ai/phonetician.ts";
import { getAgentConnection } from "../../services/agents/factory.ts";
import { trackLearningProgress, getDueReviewItems } from "../../services/spaced-repetition/tracker.ts";
import { supabaseAdmin } from "../../lib/supabase-client.ts";
import type { AgentType, ConversationMember } from "../../types/index.ts";

export const messageRoutes = new Hono();

messageRoutes.use("*", requireAuth);

function memberLanguages(member: ConversationMember): string[] {
  return [
    ...new Set([
      ...member.target_languages.map((t) => t.lang),
      ...member.base_languages,
    ]),
  ];
}

// Get messages for a conversation
messageRoutes.get("/:conversationId", async (c) => {
  const supabase = c.get("supabase");
  const conversationId = c.req.param("conversationId");
  const before = c.req.query("before");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const messages = await getMessages(supabase, conversationId, limit, before);
  return c.json(messages);
});

// Deterministic spell-check (instant, no LLM)
messageRoutes.post("/:conversationId/check", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const checkBody = await c.req.json();
  // Accept both new { text } and old { raw_text } format
  const text = checkBody.text ?? checkBody.raw_text;
  const providedLanguage = checkBody.language;

  if (!text?.trim()) {
    return c.json({ error: "Text cannot be empty" }, 400);
  }

  const senderMember = await getMember(supabase, conversationId, userId);
  if (!senderMember) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  const targetLangCodes = senderMember.target_languages.map((t) => t.lang);

  // Detect or validate language
  const language = providedLanguage && targetLangCodes.includes(providedLanguage)
    ? providedLanguage
    : detectLanguage(text, targetLangCodes);

  // Run spell/grammar check
  let errors;
  try {
    errors = await checkSpelling(text, language);
  } catch (err) {
    console.error("[Check] Spell check failed:", (err as Error).message);
    errors = [];
  }

  return c.json({
    errors,
    language,
    clean: errors.length === 0,
  });
});

// Opus error explanation (slow, rich)
messageRoutes.post("/:conversationId/explain", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const { text, errors, language, intent } = await c.req.json();

  if (!text?.trim() || !language) {
    return c.json({ error: "text and language are required" }, 400);
  }

  const senderMember = await getMember(supabase, conversationId, userId);
  if (!senderMember) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  const targetLang = senderMember.target_languages.find((t) => t.lang === language);
  const cefrLevel = targetLang?.cefr_level ?? "A1";

  const context = await getRecentMessageTexts(supabase, conversationId);

  const result = await explainErrors({
    text,
    errors: errors ?? [],
    target_language: language,
    base_languages: senderMember.base_languages,
    cefr_level: cefrLevel as any,
    intent,
    conversation_context: context,
  });

  return c.json({
    corrected_message: result.corrected_message,
    explanations: result.explanations,
    additional_errors: result.additional_errors,
  });
});

// Send a message (no rewriting — user's text goes through as-is)
messageRoutes.post("/:conversationId", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const body = await c.req.json();
  // Accept both new { text } and old { raw_text } format
  const text = body.text ?? body.raw_text;
  const { language, intent } = body;

  if (!text?.trim()) {
    return c.json({ error: "Message cannot be empty" }, 400);
  }

  const senderMember = await getMember(supabase, conversationId, userId);
  if (!senderMember) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  // Detect language if not provided
  const targetLangCodes = senderMember.target_languages.map((t) => t.lang);
  const msgLanguage = language && targetLangCodes.includes(language)
    ? language
    : detectLanguage(text, targetLangCodes);

  // Seed translations with the original text in its language
  const translations: Record<string, string> = {
    [msgLanguage]: text,
  };

  const message = await insertMessage(supabase, {
    conversation_id: conversationId,
    sender_id: userId,
    raw_text: text,
    healed_text: text, // No rewriting — user's actual text
    language: msgLanguage,
    translation: null,
    translations,
    corrections: [],
    next_challenge: null,
  });

  const userLangs = memberLanguages(senderMember);

  ensureTranslations([message], userLangs).catch(
    (err) => console.error("Failed to pre-translate message:", err),
  );
  ensureTransliterations([message], msgLanguage, userLangs).catch(
    (err) => console.error("Failed to transliterate message:", err),
  );
  ensurePhonetics([message], ["ipa"], userLangs).catch(
    (err) => console.error("Failed to generate phonetics:", err),
  );

  // Vocabulary extraction + learning tracking (async Sonnet call)
  const targetLang = senderMember.target_languages.find((t) => t.lang === msgLanguage);
  const cefrLevel = targetLang?.cefr_level ?? "A1";

  (async () => {
    try {
      const context = await getRecentMessageTexts(supabase, conversationId);
      const vocabResult = await extractVocabulary({
        text,
        language: msgLanguage,
        base_languages: senderMember.base_languages,
        cefr_level: cefrLevel as any,
        intent,
        conversation_context: context,
      });

      await trackLearningProgress(supabase, userId, msgLanguage, vocabResult);

      // Update message with the challenge
      if (vocabResult.next_challenge) {
        await supabaseAdmin
          .from("messages")
          .update({ next_challenge: vocabResult.next_challenge })
          .eq("message_id", message.message_id);
      }
    } catch (err) {
      console.error("Failed to extract vocabulary:", err);
    }
  })();

  // Forward to the agent and store its reply
  const conversation = await getConversation(supabase, conversationId);
  if (!conversation?.agent_connector_id) {
    return c.json({ error: "Conversation has no agent connector" }, 500);
  }

  try {
    const connector = await getConnector(supabase, conversation.agent_connector_id);
    if (!connector) {
      return c.json({ message, agent_message: null }, 201);
    }

    const agent = getAgentConnection(
      connector.connector_id,
      connector.type as AgentType,
      connector.config,
    );

    const [englishText] = await translateTexts([text], "en");

    const recentMsgs = await getMessages(supabase, conversationId, 20);
    const history = recentMsgs
      .filter((m) => m.message_id !== message.message_id)
      .map((m) => ({
        role: m.sender_id === userId ? "user" : "assistant",
        content: m.translations?.["en"] ?? m.healed_text,
      }));

    const agentResponse = await agent.sendMessage(englishText, history);

    const { data: agentMsg } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: conversation.created_by,
        raw_text: agentResponse,
        healed_text: agentResponse,
        language: "en",
        translation: null,
        translations: { en: agentResponse },
        corrections: [],
        next_challenge: null,
        is_agent: true,
      })
      .select()
      .single();

    if (agentMsg) {
      ensureTranslations([agentMsg], userLangs).catch(
        (err) => console.error("Failed to translate agent response:", err),
      );
      ensureTransliterations([agentMsg], "en", userLangs).catch(
        (err) => console.error("Failed to transliterate agent response:", err),
      );
      ensurePhonetics([agentMsg], ["ipa"], userLangs).catch(
        (err) => console.error("Failed to generate agent phonetics:", err),
      );
    }

    return c.json({ message, agent_message: agentMsg }, 201);
  } catch (err) {
    console.error("Agent communication failed:", err);
    return c.json({ message, agent_message: null }, 201);
  }
});

// Translate all messages in a conversation into the requested languages
messageRoutes.post("/:conversationId/translate", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const { languages } = await c.req.json();

  if (!languages?.length) {
    return c.json({ error: "languages array required" }, 400);
  }

  const member = await getMember(supabase, conversationId, userId);
  if (!member) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  const messages = await getMessages(supabase, conversationId, 500);
  await ensureTranslations(messages, languages as string[]);
  return c.json(messages);
});
