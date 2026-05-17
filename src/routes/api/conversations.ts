import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import {
  createConversation,
  getConversationsForUser,
  getConversation,
  setConversationConnector,
} from "../../services/database/conversations.ts";
import { addMember, updateMemberLanguages } from "../../services/database/members.ts";
import { getConnector } from "../../services/database/agent-connectors.ts";
import { adminDb } from "../../lib/db/index.ts";

export const conversationRoutes = new Hono();

conversationRoutes.use("*", requireAuth);

// List user's conversations
conversationRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const conversations = await getConversationsForUser(db, userId);
  return c.json(conversations);
});

// Create a new agent conversation
conversationRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { target_languages, base_languages, target_language, base_language, agent_connector_id } =
    await c.req.json();

  if (!agent_connector_id) {
    return c.json({ error: "agent_connector_id is required" }, 400);
  }

  const targetLangs = target_languages ?? [{ lang: target_language, cefr_level: "A1" }];
  const baseLangs = base_languages ?? [base_language];

  // Admin Database avoids RLS FK race on the member insert below
  const admin = adminDb();
  const conversation = await createConversation(admin, userId, agent_connector_id);

  await addMember(admin, {
    conversation_id: conversation.conversation_id,
    user_id: userId,
    target_languages: targetLangs,
    base_languages: baseLangs,
  });

  const enriched = await getConversation(db, conversation.conversation_id);
  return c.json(enriched, 201);
});

// Attach (or reattach) a connector to a conversation. Used when the original
// connector was deleted, or to swap to a different one mid-thread.
conversationRoutes.patch("/:conversationId/connector", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");
  const { agent_connector_id } = await c.req.json();

  if (!agent_connector_id) {
    return c.json({ error: "agent_connector_id is required" }, 400);
  }

  const connector = await getConnector(db, agent_connector_id);
  if (!connector) return c.json({ error: "Connector not found" }, 404);
  if (connector.created_by !== userId) return c.json({ error: "Forbidden" }, 403);

  await setConversationConnector(adminDb(), conversationId, agent_connector_id);
  const enriched = await getConversation(db, conversationId);
  return c.json(enriched);
});

// Update own language settings in a conversation
conversationRoutes.patch("/:conversationId/languages", async (c) => {
  const db = c.get("db");
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

  const member = await updateMemberLanguages(db, conversationId, userId, updates as any);
  return c.json(member);
});
