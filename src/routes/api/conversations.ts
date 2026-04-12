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

// Create a new conversation
conversationRoutes.post("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const { target_languages, base_languages, target_language, base_language, agent_connector_id } = await c.req.json();

  // Support both old single-language format and new multi-language format
  const targetLangs = target_languages ?? [{ lang: target_language, cefr_level: "A1" }];
  const baseLangs = base_languages ?? [base_language];

  // Use admin client when linking an agent (avoids FK check through RLS)
  const insertClient = agent_connector_id ? supabaseAdmin : supabase;
  const conversation = await createConversation(insertClient, userId, agent_connector_id);

  // Add creator as first member (admin for agent chats so the member insert
  // can reference the conversation before RLS sees it)
  await addMember(insertClient, {
    conversation_id: conversation.conversation_id,
    user_id: userId,
    target_languages: targetLangs,
    base_languages: baseLangs,
  });

  // Return enriched conversation with members
  const enriched = await getConversation(supabase, conversation.conversation_id);
  return c.json(enriched, 201);
});

// Join a conversation via invite code
// Uses admin client because the joining user can't read the conversation yet (RLS)
conversationRoutes.post("/join", async (c) => {
  const userId = c.get("userId");
  const { invite_code } = await c.req.json();

  // Look up via admin (bypasses RLS)
  const { data: conversation, error: lookupError } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("invite_code", invite_code)
    .single();

  if (lookupError || !conversation) {
    return c.json({ error: "Invalid invite link" }, 404);
  }

  // Check if already a member
  const { data: existingMember } = await supabaseAdmin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversation.conversation_id)
    .eq("user_id", userId)
    .single();

  if (existingMember) {
    // Already in — return enriched conversation
    const supabase = c.get("supabase");
    const enriched = await getConversation(supabase, conversation.conversation_id);
    return c.json(enriched);
  }

  // Get joining user's profile to determine default languages
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("base_language, learning_languages")
    .eq("user_id", userId)
    .single();

  const learningLangs = profile?.learning_languages ?? [];
  const targetLangs = learningLangs.length > 0
    ? learningLangs.map((l: any) => ({ lang: l.lang, cefr_level: l.cefr_level ?? "A1" }))
    : [{ lang: "en", cefr_level: "A1" }];
  const baseLangs = [profile?.base_language ?? "en"];

  // Add as member
  await supabaseAdmin
    .from("conversation_members")
    .insert({
      conversation_id: conversation.conversation_id,
      user_id: userId,
      target_languages: targetLangs,
      base_languages: baseLangs,
    });

  // Return enriched conversation via user's client (now a member, RLS allows)
  const supabase = c.get("supabase");
  const enriched = await getConversation(supabase, conversation.conversation_id);
  return c.json(enriched);
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
