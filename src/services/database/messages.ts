import type { Database, Filter } from "../../lib/db/index.ts";
import type { Message } from "../../types/index.ts";

export async function getMessages(
  db: Database,
  conversationId: string,
  limit = 50,
  before?: string,
): Promise<Message[]> {
  const filters: Filter[] = [
    { op: "eq", column: "conversation_id", value: conversationId },
  ];
  if (before) filters.push({ op: "lt", column: "created_at", value: before });
  const rows = await db.select<Message>("messages", {
    filters,
    order: [{ column: "created_at", ascending: false }],
    limit,
  });
  return rows.reverse(); // chronological
}

export async function insertMessage(
  db: Database,
  message: Pick<
    Message,
    | "conversation_id"
    | "sender_id"
    | "raw_text"
    | "healed_text"
    | "language"
    | "translation"
    | "translations"
    | "corrections"
    | "next_challenge"
  >,
): Promise<Message> {
  return db.insert<Message>("messages", message);
}

export async function getRecentMessageTexts(
  db: Database,
  conversationId: string,
  limit = 5,
): Promise<string[]> {
  const rows = await db.select<{ healed_text: string }>("messages", {
    columns: "healed_text",
    filters: [{ op: "eq", column: "conversation_id", value: conversationId }],
    order: [{ column: "created_at", ascending: false }],
    limit,
  });
  return rows.reverse().map((r) => r.healed_text);
}
