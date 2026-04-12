import type { AgentConnection, AgentStatusInfo, AgentStatusListener, HttpConfig } from "./types.ts";

/**
 * Generic HTTP agent connector.
 * POSTs messages to any endpoint and extracts the response.
 */
export class HttpAgent implements AgentConnection {
  private url: string;
  private headers: Record<string, string>;
  private bodyTemplate: string;
  private responsePath: string;

  getStatus(): AgentStatusInfo {
    return { status: "connected", since: new Date(), failedAttempts: 0 };
  }

  onStatusChange(_listener: AgentStatusListener): void {
    // Stateless — no persistent connection to monitor
  }

  constructor(agentConfig: HttpConfig) {
    this.url = agentConfig.url;
    this.headers = {
      "Content-Type": "application/json",
      ...(agentConfig.headers ?? {}),
    };
    this.bodyTemplate = agentConfig.body_template ?? '{"message":"{{message}}"}';
    this.responsePath = agentConfig.response_path ?? "response";
  }

  async sendMessage(text: string): Promise<string> {
    const body = this.bodyTemplate.replace(/\{\{message\}\}/g, JSON.stringify(text).slice(1, -1));

    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers,
      body,
    });

    if (!res.ok) {
      throw new Error(`Agent HTTP request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Navigate the response path (e.g. "choices[0].message.content")
    return extractPath(data, this.responsePath);
  }

  disconnect() {
    // No persistent connection
  }
}

function extractPath(obj: any, path: string): string {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return "";
    current = current[part];
  }
  return String(current ?? "");
}
