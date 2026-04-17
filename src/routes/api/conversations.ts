import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import {
  createConversation,
  getConversationsForUser,
  getConversation,
} from "../../services/database/conversations.ts";
import { addMember, updateMemberLanguages } from "../../services/database/members.ts";
import { supabaseAdmin } from "../../lib/supabase-client.ts";

export const conversationRoutes = new Hono();

conversationRoutes.use("*", requireAuth);

// List user's conversations
conversationRoutes.get("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");

  const conversations = await getConversationsForUser(supabase, userId);
  return c.json(conversations);
});

// Create a new agent conversation
conversationRoutes.post("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const { target_languages, base_languages, target_language, base_language, agent_connector_id } = await c.req.json();

  if (!agent_connector_id) {
    return c.json({ error: "agent_connector_id is required" }, 400);
  }

  const targetLangs = target_languages ?? [{ lang: target_language, cefr_level: "A1" }];
  const baseLangs = base_languages ?? [base_language];

  // Admin client avoids RLS FK race on the member insert below
  const conversation = await createConversation(supabaseAdmin, userId, agent_connector_id);

  await addMember(supabaseAdmin, {
    conversation_id: conversation.conversation_id,
    user_id: userId,
    target_languages: targetLangs,
    base_languages: baseLangs,
  });

  const enriched = await getConversation(supabase, conversation.conversation_id);
  return c.json(enriched, 201);
});

// Update own language settings in a conversation
conversationRoutes.patch("/:conversationId/languages", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const body = await c.req.json();

  // Normalize: accept both new format (target_languages/base_languages)
  // and old format (target_language/base_language) for backward compat
  const updates: Record<string, unknown> = {};
  if (body.target_languages) {
    updates.target_languages = body.target_languages;
  } else if (body.target_language) {
    updates.target_languages = [{ lang: body.target_language, cefr_level: "A1" }];
  }
  if (body.base_languages) {
    updates.base_languages = body.base_languages;
  } else if (body.base_language) {
    updates.base_languages = [body.base_language];
  }

  const member = await updateMemberLanguages(supabase, conversationId, userId, updates as any);
  return c.json(member);
});
