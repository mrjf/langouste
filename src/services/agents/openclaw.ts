import type {
  AgentConnection,
  AgentStatus,
  AgentStatusInfo,
  AgentStatusListener,
  OpenClawConfig,
} from "./types.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * OpenClaw agent connector.
 * Connects lazily on first sendMessage. If the gateway isn't available,
 * records the status and doesn't retry until the next sendMessage call.
 * Once connected, auto-reconnects on disconnect so in-session drops recover.
 */
export class OpenClawAgent implements AgentConnection {
  private url: string;
  private deviceName: string;
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: string) => void; reject: (reason: Error) => void }
  >();

  private statusInfo: AgentStatusInfo = {
    status: "disconnected",
    since: new Date(),
    failedAttempts: 0,
  };
  private listeners: AgentStatusListener[] = [];
  private connecting: Promise<WebSocket> | null = null;
  private stopped = false;

  constructor(config: OpenClawConfig) {
    this.url = config.url || "ws://127.0.0.1:18789";
    this.deviceName = config.device_name || "langouste";
  }

  // --- Status ---

  getStatus(): AgentStatusInfo {
    return { ...this.statusInfo };
  }

  onStatusChange(listener: AgentStatusListener): void {
    this.listeners.push(listener);
  }

  private setStatus(status: AgentStatus, detail?: string): void {
    const wasError = this.statusInfo.status === "error";
    this.statusInfo = {
      status,
      detail,
      since: new Date(),
      failedAttempts:
        status === "connected"
          ? 0
          : status === "error"
            ? this.statusInfo.failedAttempts + 1
            : this.statusInfo.failedAttempts,
    };
    // Only log transitions, not repeated errors
    if (!(status === "error" && wasError)) {
      console.log(
        `[OpenClaw] status=${status}${detail ? ` (${detail})` : ""}`,
      );
    }
    for (const listener of this.listeners) {
      try {
        listener(this.statusInfo);
      } catch {
        // don't let a bad listener break us
      }
    }
  }

  // --- Connection ---

  private connect(): Promise<WebSocket> {
    // Deduplicate concurrent connect attempts
    if (this.connecting) return this.connecting;

    this.setStatus("connecting", this.url);

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.url);

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          // Don't reject here — onclose/onerror will handle it
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        this.connecting = null;

        const handshake = {
          type: "connect",
          device: {
            name: this.deviceName,
            role: "client",
            capabilities: [],
          },
        };
        console.log(`[OpenClaw] → handshake as "${this.deviceName}"`);
        ws.send(JSON.stringify(handshake));
        this.setStatus("connected", this.url);
        resolve(ws);
      };

      ws.onmessage = (event) => {
        const raw = String(event.data);
        console.log(`[OpenClaw] ← ${raw.slice(0, 200)}`);
        try {
          const frame = JSON.parse(raw);
          if (frame.type === "res" && frame.id != null) {
            const pending = this.pendingRequests.get(frame.id);
            if (pending) {
              this.pendingRequests.delete(frame.id);
              if (frame.ok) {
                const text =
                  frame.payload?.text ??
                  frame.payload?.message ??
                  frame.payload?.content ??
                  JSON.stringify(frame.payload);
                pending.resolve(String(text));
              } else {
                pending.reject(
                  new Error(frame.error?.message ?? "Agent request failed"),
                );
              }
            }
          }
        } catch {
          console.warn(`[OpenClaw] Unparseable frame: ${raw.slice(0, 200)}`);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        this.connecting = null;
        this.setStatus("error", `Failed to connect to ${this.url}`);
        reject(new Error(`Failed to connect to OpenClaw at ${this.url}`));
      };

      ws.onclose = (event) => {
        clearTimeout(connectTimeout);
        this.ws = null;
        this.connecting = null;

        // Reject any pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error("Connection lost"));
          this.pendingRequests.delete(id);
        }

        if (this.statusInfo.status === "connected") {
          // Was connected, lost connection — mark as error so next sendMessage retries
          this.setStatus(
            "error",
            `Connection lost (code=${event.code})`,
          );
        }
      };
    });

    return this.connecting;
  }

  // --- Messaging ---

  async sendMessage(text: string): Promise<string> {
    if (this.stopped) {
      throw new Error("OpenClaw agent has been disconnected");
    }

    console.log(`[OpenClaw] sendMessage: "${text.slice(0, 100)}..."`);

    // Connect or reconnect on demand
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const frame = {
        type: "req",
        id,
        method: "agent",
        params: { message: text },
      };
      console.log(`[OpenClaw] → ${JSON.stringify(frame)}`);
      this.ws!.send(JSON.stringify(frame));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Agent response timed out"));
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  // --- Cleanup ---

  disconnect(): void {
    this.stopped = true;
    this.connecting = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Disconnected"));
    }
    this.pendingRequests.clear();
    this.setStatus("disconnected", "Manual disconnect");
  }
}
