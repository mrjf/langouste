import { config } from "../../lib/config.ts";
import type { Database } from "../../lib/db/index.ts";
import type {
  AgentConnector,
  Conversation,
  ConversationMember,
  Profile,
} from "../../types/index.ts";

/**
 * Conversation with members and agent connector eagerly loaded. The shape
 * mirrors what the Svelte client expects (conversations.value[i]).
 */
export interface EnrichedConversation extends Conversation {
  members: Array<
    ConversationMember & { profile: Pick<Profile, "user_id" | "display_name"> | null }
  >;
  agent_connector: AgentConnector | null;
}

const SUPABASE_NESTED_SELECT = `
  *,
  members:conversation_members(
    user_id,
    target_languages,
    base_languages,
    joined_at,
    profile:profiles(user_id, display_name)
  ),
  agent_connector:agent_connectors(connector_id, name, type, config)
`;

export async function getConversationsForUser(
  db: Database,
  userId: string,
): Promise<EnrichedConversation[]> {
  const memberRows = await db.select<{ conversation_id: string }>(
    "conversation_members",
    {
      columns: "conversation_id",
      filters: [{ op: "eq", column: "user_id", value: userId }],
    },
  );
  if (memberRows.length === 0) return [];

  const convIds = memberRows.map((m) => m.conversation_id);

  // Supabase supports nested selects via PostgREST embedding; SQLite doesn't,
  // so branch here.
  return config.databaseMode === "supabase"
    ? supabaseSelectNested(db, convIds)
    : sqliteSelectEnriched(db, convIds);
}

export async function getConversation(
  db: Database,
  conversationId: string,
): Promise<EnrichedConversation | null> {
  if (config.databaseMode === "supabase") {
    const rows = await supabaseSelectNested(db, [conversationId]);
    return rows[0] ?? null;
  }
  const rows = await sqliteSelectEnriched(db, [conversationId]);
  return rows[0] ?? null;
}

export async function createConversation(
  db: Database,
  createdBy: string,
  agentConnectorId?: string,
): Promise<Conversation> {
  const row: Record<string, unknown> = { created_by: createdBy };
  if (agentConnectorId) row.agent_connector_id = agentConnectorId;
  return db.insert<Conversation>("conversations", row);
}

/** Update a conversation's agent_connector_id (used to reattach orphans). */
export async function setConversationConnector(
  db: Database,
  conversationId: string,
  agentConnectorId: string,
): Promise<void> {
  await db.update(
    "conversations",
    { agent_connector_id: agentConnectorId },
    [{ op: "eq", column: "conversation_id", value: conversationId }],
  );
}

// --- Supabase nested-select path ---
// Uses the existing PostgREST embed feature. The `columns` param carries the
// nested-select syntax; the abstraction layer passes it through as-is.
async function supabaseSelectNested(
  db: Database,
  convIds: string[],
): Promise<EnrichedConversation[]> {
  const rows = await db.select<EnrichedConversation>("conversations", {
    columns: SUPABASE_NESTED_SELECT,
    filters: [{ op: "in", column: "conversation_id", values: convIds }],
    order: [{ column: "created_at", ascending: false }],
  });
  return rows;
}

// --- SQLite fan-out path ---
// One conversation-row query, one members query, one agent-connector query,
// stitched together in TypeScript.
async function sqliteSelectEnriched(
  db: Database,
  convIds: string[],
): Promise<EnrichedConversation[]> {
  if (convIds.length === 0) return [];

  const convs = await db.select<Conversation>("conversations", {
    filters: [{ op: "in", column: "conversation_id", values: convIds }],
    order: [{ column: "created_at", ascending: false }],
  });

  const members = await db.select<
    ConversationMember & { display_name?: string | null }
  >("conversation_members", {
    filters: [{ op: "in", column: "conversation_id", values: convIds }],
  });

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const profiles = userIds.length
    ? await db.select<Pick<Profile, "user_id" | "display_name">>("profiles", {
        columns: "user_id, display_name",
        filters: [{ op: "in", column: "user_id", values: userIds }],
      })
    : [];
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  const connectorIds = convs
    .map((c) => c.agent_connector_id)
    .filter((id): id is string => !!id);
  const connectors = connectorIds.length
    ? await db.select<AgentConnector>("agent_connectors", {
        filters: [{ op: "in", column: "connector_id", values: connectorIds }],
      })
    : [];
  const connectorById = new Map(connectors.map((c) => [c.connector_id, c]));

  return convs.map((c) => ({
    ...c,
    members: members
      .filter((m) => m.conversation_id === c.conversation_id)
      .map((m) => ({
        ...m,
        profile: profileById.get(m.user_id) ?? null,
      })),
    agent_connector: c.agent_connector_id
      ? connectorById.get(c.agent_connector_id) ?? null
      : null,
  }));
}
