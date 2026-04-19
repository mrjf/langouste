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
 * OpenClaw agent connector. Speaks the gateway's protocol v3 frame format:
 *
 *   → { type: "req", id: "<string>", method: "connect", params: {...} }
 *   ← { type: "event", event: "connect.challenge", payload: {...} }   (ignored when auth=none)
 *   ← { type: "res", id: "<same>", ok: true, payload: { type: "hello-ok", ... } }
 *
 *   → { type: "req", id: "<string>", method: "agent", params: { message } }
 *   ← { type: "res", id: "<same>", ok: true, payload: {...} }
 *
 * See docs.openclaw.ai/cli/gateway and the ConnectParamsSchema in the
 * gateway bundle. Frame IDs are strings (per schema), so we track pending
 * requests keyed by string.
 *
 * Auth:
 *   - `auth=none` gateway: leave `config.token` empty. Works out of the box.
 *   - `auth=token` gateway: set `config.token` to the value in
 *     ~/.openclaw/openclaw.json → gateway.auth.token. BUT the gateway only
 *     grants operator.write scope to device-keypair-signed clients, so even
 *     with the correct token the agent calls will fail "missing scope:
 *     operator.write" until we implement device identity (Ed25519 pairing).
 *     For integration testing, `openclaw gateway --auth none` is the path.
 */

const CLIENT_PROTOCOL_VERSION = 3;
const CLIENT_ID = "gateway-client"; // one of the valid GATEWAY_CLIENT_IDS
const CLIENT_MODE = "backend"; // one of the valid GATEWAY_CLIENT_MODES
const CLIENT_VERSION = "0.1.0"; // Langouste's openclaw connector version

export class OpenClawAgent implements AgentConnection {
  private url: string;
  private deviceName: string;
  private token: string | undefined;
  private ws: WebSocket | null = null;
  private requestCounter = 0;
  private pendingRequests = new Map<
    string,
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
    this.token = (config as { token?: string }).token?.trim() || undefined;
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
    if (!(status === "error" && wasError)) {
      console.log(`[OpenClaw] status=${status}${detail ? ` (${detail})` : ""}`);
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

  private nextRequestId(): string {
    return `langouste-${++this.requestCounter}-${Date.now().toString(36)}`;
  }

  private connect(): Promise<WebSocket> {
    if (this.connecting) return this.connecting;

    this.setStatus("connecting", this.url);

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.url);

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
        }
      }, CONNECT_TIMEOUT_MS);

      const connectId = this.nextRequestId();
      let handshakeComplete = false;

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        const frame = {
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: CLIENT_PROTOCOL_VERSION,
            maxProtocol: CLIENT_PROTOCOL_VERSION,
            client: {
              id: CLIENT_ID,
              displayName: this.deviceName,
              version: CLIENT_VERSION,
              platform: process.platform,
              mode: CLIENT_MODE,
            },
            role: "operator",
            scopes: ["operator.write", "operator.read"],
            ...(this.token ? { auth: { token: this.token } } : {}),
          },
        };
        console.log(`[OpenClaw] → handshake as "${this.deviceName}"`);
        ws.send(JSON.stringify(frame));
      };

      ws.onmessage = (event) => {
        const raw = String(event.data);
        console.log(`[OpenClaw] ← ${raw.slice(0, 200)}`);
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw);
        } catch {
          console.warn(`[OpenClaw] Unparseable frame: ${raw.slice(0, 200)}`);
          return;
        }

        // Handshake response to our connect request.
        if (!handshakeComplete && frame.type === "res" && frame.id === connectId) {
          if (frame.ok) {
            handshakeComplete = true;
            this.ws = ws;
            this.connecting = null;
            this.setStatus("connected", this.url);
            resolve(ws);
          } else {
            const err = frame.error as { message?: string } | undefined;
            const msg = err?.message ?? "Handshake rejected";
            this.connecting = null;
            this.setStatus("error", msg);
            ws.close();
            reject(new Error(`OpenClaw handshake failed: ${msg}`));
          }
          return;
        }

        // Ignore events and pre-handshake frames.
        if (frame.type !== "res" || typeof frame.id !== "string") return;

        const pending = this.pendingRequests.get(frame.id);
        if (!pending) return;
        this.pendingRequests.delete(frame.id);

        if (frame.ok) {
          const payload = frame.payload as { text?: string; message?: string; content?: string } | undefined;
          const text = payload?.text ?? payload?.message ?? payload?.content ?? JSON.stringify(payload ?? {});
          pending.resolve(String(text));
        } else {
          const err = frame.error as { message?: string } | undefined;
          pending.reject(new Error(err?.message ?? "Agent request failed"));
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        if (!handshakeComplete) {
          this.connecting = null;
          this.setStatus("error", `Failed to connect to ${this.url}`);
          reject(new Error(`Failed to connect to OpenClaw at ${this.url}`));
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectTimeout);
        this.ws = null;
        this.connecting = null;

        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Connection lost (code=${event.code})`));
          this.pendingRequests.delete(id);
        }

        if (!handshakeComplete) {
          // Reject the pending connect promise if we haven't already.
          this.setStatus("error", `Handshake closed (code=${event.code})`);
          reject(new Error(`OpenClaw connection closed before handshake (code=${event.code})`));
        } else if (this.statusInfo.status === "connected") {
          this.setStatus("error", `Connection lost (code=${event.code})`);
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

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.nextRequestId();

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
