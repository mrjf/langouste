import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import {
  getConnectorsForUser,
  getConnector,
  createConnector,
  updateConnector,
  deleteConnector,
} from "../../services/database/agent-connectors.ts";
import { getAgentConnection, disconnectAgent } from "../../services/agents/factory.ts";
import type { AgentType } from "../../types/index.ts";
import type { AuthenticatedRouteBindings } from "../types.ts";

export const agentConnectorRoutes = new Hono<AuthenticatedRouteBindings>();

agentConnectorRoutes.use("*", requireAuth);

// List user's connectors
agentConnectorRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const connectors = await getConnectorsForUser(db, userId);
  return c.json(connectors);
});

// Create a connector
agentConnectorRoutes.post("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const { name, type, config } = await c.req.json();

  const connector = await createConnector(db, {
    name,
    type,
    config: config ?? {},
    created_by: userId,
  });

  return c.json(connector, 201);
});

// Edit a connector's name and/or config. Type is immutable — to change it,
// delete and recreate.
agentConnectorRoutes.patch("/:connectorId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const connectorId = c.req.param("connectorId");
  const body = await c.req.json();

  const existing = await getConnector(db, connectorId);
  if (!existing) return c.json({ error: "Connector not found" }, 404);
  if (existing.created_by !== userId) return c.json({ error: "Forbidden" }, 403);

  const updates: Partial<{ name: string; config: Record<string, unknown> }> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (body.config && typeof body.config === "object") updates.config = body.config;

  if (Object.keys(updates).length === 0) {
    return c.json(existing);
  }

  // Drop the cached in-memory agent so the next send constructs a fresh one
  // with the updated config.
  disconnectAgent(connectorId);

  const updated = await updateConnector(db, connectorId, updates);
  return c.json(updated);
});

// Delete a connector. Conversations that used it will have their
// agent_connector_id set to null by the FK ON DELETE SET NULL clause; the
// client shows an orphan banner so the user can reattach.
agentConnectorRoutes.delete("/:connectorId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const connectorId = c.req.param("connectorId");

  const existing = await getConnector(db, connectorId);
  if (!existing) return c.json({ ok: true }); // idempotent
  if (existing.created_by !== userId) return c.json({ error: "Forbidden" }, 403);

  disconnectAgent(connectorId);
  await deleteConnector(db, connectorId);
  return c.json({ ok: true });
});

// Get connector connection status
agentConnectorRoutes.get("/:connectorId/status", async (c) => {
  const db = c.get("db");
  const connectorId = c.req.param("connectorId");

  const connector = await getConnector(db, connectorId);
  if (!connector) return c.json({ error: "Connector not found" }, 404);

  try {
    const agent = getAgentConnection(
      connector.connector_id,
      connector.type as AgentType,
      connector.config,
    );
    const info = agent.getStatus();
    return c.json({
      status: info.status,
      detail: info.detail,
      since: info.since.toISOString(),
      failed_attempts: info.failedAttempts,
    });
  } catch (err: any) {
    return c.json({ status: "error", detail: err.message, failed_attempts: 0 }, 500);
  }
});

// Test a connector
agentConnectorRoutes.post("/:connectorId/test", async (c) => {
  const db = c.get("db");
  const connectorId = c.req.param("connectorId");

  const connector = await getConnector(db, connectorId);
  if (!connector) return c.json({ error: "Connector not found" }, 404);

  try {
    const agent = getAgentConnection(
      connector.connector_id,
      connector.type as AgentType,
      connector.config,
    );
    const response = await agent.sendMessage(
      "Hello, this is a test message. Please respond briefly.",
    );
    return c.json({ ok: true, response });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});
