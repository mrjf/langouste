import type { Database } from "../../lib/db/index.ts";
import type { AgentConnector } from "../../types/index.ts";

export async function getConnectorsForUser(
  db: Database,
  userId: string,
): Promise<AgentConnector[]> {
  return db.select<AgentConnector>("agent_connectors", {
    filters: [{ op: "eq", column: "created_by", value: userId }],
    order: [{ column: "created_at", ascending: false }],
  });
}

export async function getConnector(
  db: Database,
  connectorId: string,
): Promise<AgentConnector | null> {
  return db.selectOne<AgentConnector>("agent_connectors", {
    filters: [{ op: "eq", column: "connector_id", value: connectorId }],
  });
}

export async function createConnector(
  db: Database,
  connector: Pick<AgentConnector, "name" | "type" | "config" | "created_by">,
): Promise<AgentConnector> {
  return db.insert<AgentConnector>("agent_connectors", connector);
}

export async function updateConnector(
  db: Database,
  connectorId: string,
  updates: Partial<Pick<AgentConnector, "name" | "config">>,
): Promise<AgentConnector> {
  return db.updateOne<AgentConnector>("agent_connectors", updates, [
    { op: "eq", column: "connector_id", value: connectorId },
  ]);
}

export async function deleteConnector(db: Database, connectorId: string): Promise<void> {
  await db.delete("agent_connectors", [{ op: "eq", column: "connector_id", value: connectorId }]);
}
