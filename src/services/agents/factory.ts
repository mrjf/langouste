import type { AgentConnection } from "./types.ts";
import type { AgentType } from "../../types/index.ts";
import { config as appConfig } from "../../lib/config.ts";
import { ClaudeAgent } from "./claude.ts";
import { ClaudeCodeAgent } from "./claude-code.ts";
import { OpenClawAgent } from "./openclaw.ts";
import { HttpAgent } from "./http.ts";
import { StubAgent } from "./stub.ts";
// Cache active connections by connector_id
const connections = new Map<string, AgentConnection>();

export function getAgentConnection(
  connectorId: string,
  type: AgentType,
  config: Record<string, unknown>,
): AgentConnection {
  const existing = connections.get(connectorId);
  if (existing) return existing;

  let conn: AgentConnection;
  switch (type) {
    case "claude":
      conn = new ClaudeAgent(config as any);
      break;
    case "claude-code":
      conn = new ClaudeCodeAgent(config as any);
      break;
    case "openclaw":
      conn = new OpenClawAgent(config as any);
      break;
    case "http":
      conn = new HttpAgent(config as any);
      break;
    case "stub":
      if (!appConfig.testMode) {
        throw new Error("stub agent type requires LANGOUSTE_TEST_MODE=true");
      }
      conn = new StubAgent();
      break;
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }

  connections.set(connectorId, conn);
  return conn;
}

export function disconnectAgent(connectorId: string) {
  const conn = connections.get(connectorId);
  if (conn) {
    conn.disconnect();
    connections.delete(connectorId);
  }
}
