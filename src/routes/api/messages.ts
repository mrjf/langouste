import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getMessages, getRecentMessageTexts, insertMessage } from "../../services/database/messages.ts";
import { getMember, getMembers } from "../../services/database/members.ts";
import { processMessage } from "../../services/ai/message-processor.ts";
import { trackLearningProgress, getDueReviewItems } from "../../services/spaced-repetition/tracker.ts";
import type { LearningLanguage } from "../../types/index.ts";

export const messageRoutes = new Hono();

messageRoutes.use("*", requireAuth);

// Get messages for a conversation
messageRoutes.get("/:conversationId", async (c) => {
  const supabase = c.get("supabase");
  const conversationId = c.req.param("conversationId");
  const before = c.req.query("before");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const messages = await getMessages(supabase, conversationId, limit, before);
  return c.json(messages);
});

// Send a message
messageRoutes.post("/:conversationId", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const { raw_text } = await c.req.json();

  if (!raw_text?.trim()) {
    return c.json({ error: "Message cannot be empty" }, 400);
  }

  // Get sender's membership (has their target_language and base_language)
  const senderMember = await getMember(supabase, conversationId, userId);
  if (!senderMember) {
    return c.json({ error: "Not a member of this conversation" }, 403);
  }

  // Get sender's profile for CEFR level
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("base_language, learning_languages")
    .eq("user_id", userId)
    .single();

  if (!senderProfile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // Find sender's CEFR level for their target language
  const senderLearning = (senderProfile.learning_languages as LearningLanguage[])
    .find((l) => l.lang === senderMember.target_language);
  const senderCefrLevel = senderLearning?.cefr_level ?? "A1";

  // Get other members to determine recipient info
  // For now, pick the first other member as "recipient" for translation purposes
  const allMembers = await getMembers(supabase, conversationId);
  const otherMembers = allMembers.filter((m) => m.user_id !== userId);
  const recipient = otherMembers[0]; // primary recipient for translation

  let recipientBaseLanguage = "en";
  let recipientCefrLevel: string | null = null;

  if (recipient) {
    recipientBaseLanguage = recipient.base_language;
    // Check if recipient is learning the sender's target language
    const { data: recipientProfile } = await supabase
      .from("profiles")
      .select("learning_languages")
      .eq("user_id", recipient.user_id)
      .single();

    const recipientLearning = (recipientProfile?.learning_languages as LearningLanguage[] ?? [])
      .find((l) => l.lang === senderMember.target_language);
    recipientCefrLevel = recipientLearning?.cefr_level ?? null;
  }

  // Get conversation context and due review items
  const [context, dueItems] = await Promise.all([
    getRecentMessageTexts(supabase, conversationId),
    getDueReviewItems(supabase, userId, senderMember.target_language),
  ]);

  // Process through AI
  const aiResult = await processMessage({
    raw_text,
    sender_base_language: senderMember.base_language,
    sender_target_language: senderMember.target_language,
    sender_cefr_level: senderCefrLevel,
    recipient_base_language: recipientBaseLanguage,
    recipient_cefr_level: recipientCefrLevel,
    recent_grammar_gaps: dueItems.grammar_gaps,
    recent_vocabulary: dueItems.vocabulary,
    conversation_context: context,
  });

  // Store message
  const message = await insertMessage(supabase, {
    conversation_id: conversationId,
    sender_id: userId,
    raw_text,
    healed_text: aiResult.healed_text,
    translation: aiResult.translation,
    corrections: aiResult.corrections,
    next_challenge: aiResult.next_challenge,
  });

  // Track learning progress asynchronously (don't block the response)
  trackLearningProgress(supabase, userId, senderMember.target_language, aiResult).catch(
    (err) => console.error("Failed to track learning progress:", err),
  );

  return c.json({
    message,
    corrections: aiResult.corrections,
    next_challenge: aiResult.next_challenge,
  }, 201);
});
