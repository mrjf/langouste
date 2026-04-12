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
  const { target_language, base_language } = await c.req.json();

  // Create the conversation
  const conversation = await createConversation(supabase, userId);

  // Add creator as first member
  await addMember(supabase, {
    conversation_id: conversation.conversation_id,
    user_id: userId,
    target_language,
    base_language,
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

  const targetLang = profile?.learning_languages?.[0]?.lang ?? "en";
  const baseLang = profile?.base_language ?? "en";

  // Add as member
  await supabaseAdmin
    .from("conversation_members")
    .insert({
      conversation_id: conversation.conversation_id,
      user_id: userId,
      target_language: targetLang,
      base_language: baseLang,
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
  const updates = await c.req.json();

  const member = await updateMemberLanguages(supabase, conversationId, userId, updates);
  return c.json(member);
});
