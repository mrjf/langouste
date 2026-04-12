import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getMessages, getRecentMessageTexts, insertMessage } from "../../services/database/messages.ts";
import { getMember, getMembers } from "../../services/database/members.ts";
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
import type { AgentType } from "../../types/index.ts";

export const messageRoutes = new Hono();

messageRoutes.use("*", requireAuth);

/**
 * Collect all unique languages that members of this conversation need.
 */
async function allMemberLanguages(
  supabase: any,
  conversationId: string,
): Promise<string[]> {
  const members = await getMembers(supabase, conversationId);
  const langs = new Set<string>();
  for (const m of members) {
    for (const t of m.target_languages) langs.add(t.lang);
    for (const b of m.base_languages) langs.add(b);
  }
  return [...langs];
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

  // Async post-send processing (does not block the response)
  const memberLangs = await allMemberLanguages(supabase, conversationId);

  ensureTranslations([message], memberLangs).catch(
    (err) => console.error("Failed to pre-translate message:", err),
  );
  ensureTransliterations([message], msgLanguage, memberLangs).catch(
    (err) => console.error("Failed to transliterate message:", err),
  );
  ensurePhonetics([message], ["ipa"], memberLangs).catch(
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

  // If this is an agent chat, forward to the agent and store its reply
  const conversation = await getConversation(supabase, conversationId);
  if (conversation?.agent_connector_id) {
    try {
      const connector = await getConnector(supabase, conversation.agent_connector_id);
      if (connector) {
        const agent = getAgentConnection(
          connector.connector_id,
          connector.type as AgentType,
          connector.config,
        );

        // Translate user's message to English for the agent
        const [englishText] = await translateTexts([text], "en");

        // Build conversation history for context
        const recentMsgs = await getMessages(supabase, conversationId, 20);
        const history = recentMsgs
          .filter((m) => m.message_id !== message.message_id)
          .map((m) => ({
            role: m.sender_id === userId ? "user" : "assistant",
            content: m.translations?.["en"] ?? m.healed_text,
          }));

        const agentResponse = await agent.sendMessage(englishText, history);

        const agentTranslations: Record<string, string> = { en: agentResponse };
        const { data: agentMsg } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: conversationId,
            sender_id: conversation.created_by,
            raw_text: agentResponse,
            healed_text: agentResponse,
            language: "en",
            translation: null,
            translations: agentTranslations,
            corrections: [],
            next_challenge: null,
            is_agent: true,
          })
          .select()
          .single();

        if (agentMsg) {
          const langs = [...new Set([
            ...senderMember.target_languages.map((t) => t.lang),
            ...senderMember.base_languages,
          ])];
          ensureTranslations([agentMsg], langs).catch(
            (err) => console.error("Failed to translate agent response:", err),
          );
          ensureTransliterations([agentMsg], "en", langs).catch(
            (err) => console.error("Failed to transliterate agent response:", err),
          );
          ensurePhonetics([agentMsg], ["ipa"], langs).catch(
            (err) => console.error("Failed to generate agent phonetics:", err),
          );
        }

        return c.json({
          message,
          agent_message: agentMsg,
        }, 201);
      }
    } catch (err) {
      console.error("Agent communication failed:", err);
    }
  }

  return c.json({ message }, 201);
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
