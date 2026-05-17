import type { Database } from "../../lib/db/index.ts";
import type { ConversationMember } from "../../types/index.ts";

export async function addMember(
  db: Database,
  member: Pick<
    ConversationMember,
    "conversation_id" | "user_id" | "target_languages" | "base_languages"
  >,
): Promise<ConversationMember> {
  return db.insert<ConversationMember>("conversation_members", member);
}

export async function getMember(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<ConversationMember | null> {
  return db.selectOne<ConversationMember>("conversation_members", {
    filters: [
      { op: "eq", column: "conversation_id", value: conversationId },
      { op: "eq", column: "user_id", value: userId },
    ],
  });
}

/**
 * Mark a conversation read for a user: set last_read_at to now (or an
 * explicit ISO timestamp). Resets the unread badge. No-op-safe: if the
 * member row doesn't exist the update matches zero rows.
 */
export async function markConversationRead(
  db: Database,
  conversationId: string,
  userId: string,
  at: string = new Date().toISOString(),
): Promise<void> {
  await db.update("conversation_members", { last_read_at: at }, [
    { op: "eq", column: "conversation_id", value: conversationId },
    { op: "eq", column: "user_id", value: userId },
  ]);
}

export async function updateMemberLanguages(
  db: Database,
  conversationId: string,
  userId: string,
  updates: Partial<Pick<ConversationMember, "target_languages" | "base_languages">>,
): Promise<ConversationMember> {
  return db.updateOne<ConversationMember>("conversation_members", updates, [
    { op: "eq", column: "conversation_id", value: conversationId },
    { op: "eq", column: "user_id", value: userId },
  ]);
}
