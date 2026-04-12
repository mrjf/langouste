import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import {
  getConnectorsForUser,
  getConnector,
  createConnector,
  deleteConnector,
} from "../../services/database/agent-connectors.ts";
import { getAgentConnection, disconnectAgent } from "../../services/agents/factory.ts";
import type { AgentType } from "../../types/index.ts";

export const agentConnectorRoutes = new Hono();

agentConnectorRoutes.use("*", requireAuth);

// List user's connectors
agentConnectorRoutes.get("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const connectors = await getConnectorsForUser(supabase, userId);
  return c.json(connectors);
});

// Create a connector
agentConnectorRoutes.post("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const { name, type, config } = await c.req.json();

  const connector = await createConnector(supabase, {
    name,
    type,
    config: config ?? {},
    created_by: userId,
  });

  return c.json(connector, 201);
});

// Delete a connector
agentConnectorRoutes.delete("/:connectorId", async (c) => {
  const supabase = c.get("supabase");
  const connectorId = c.req.param("connectorId");
  disconnectAgent(connectorId);
  await deleteConnector(supabase, connectorId);
  return c.json({ ok: true });
});

// Get connector connection status
agentConnectorRoutes.get("/:connectorId/status", async (c) => {
  const supabase = c.get("supabase");
  const connectorId = c.req.param("connectorId");

  const connector = await getConnector(supabase, connectorId);
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
  const supabase = c.get("supabase");
  const connectorId = c.req.param("connectorId");

  const connector = await getConnector(supabase, connectorId);
  if (!connector) return c.json({ error: "Connector not found" }, 404);

  try {
    const agent = getAgentConnection(
      connector.connector_id,
      connector.type as AgentType,
      connector.config,
    );
    const response = await agent.sendMessage("Hello, this is a test message. Please respond briefly.");
    return c.json({ ok: true, response });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});
