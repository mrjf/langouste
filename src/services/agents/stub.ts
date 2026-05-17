import { testRegistry } from "../../lib/test-registry.ts";
import type { AgentConnection, AgentStatusInfo, AgentStatusListener } from "./types.ts";

/**
 * Test-only agent connector. Returns scripted replies from testRegistry.
 * Only wired into the factory when config.testMode is true.
 */
export class StubAgent implements AgentConnection {
  getStatus(): AgentStatusInfo {
    return {
      status: "connected",
      detail: "stub",
      since: new Date(),
      failedAttempts: 0,
    };
  }

  onStatusChange(_listener: AgentStatusListener): void {
    // no-op
  }

  async sendMessage(text: string): Promise<string> {
    return testRegistry.getAgentReply(text);
  }

  disconnect(): void {
    // no-op
  }
}
