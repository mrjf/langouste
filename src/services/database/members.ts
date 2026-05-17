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
