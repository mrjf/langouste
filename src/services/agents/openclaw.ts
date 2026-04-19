import {
  buildDeviceAuthPayloadV3,
  loadOrCreateConnectorIdentity,
  signPayload,
  type DeviceIdentity,
} from "./openclaw-identity.ts";
import type {
  AgentConnection,
  AgentStatus,
  AgentStatusInfo,
  AgentStatusListener,
  OpenClawConfig,
} from "./types.ts";

const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * OpenClaw agent connector. Speaks protocol v3 and performs Ed25519 device
 * identity pairing so the gateway grants operator.write on the WS path.
 *
 * Flow on first connect per instance:
 *
 *   1. WS upgrade.
 *   2. Server sends `{type:"event", event:"connect.challenge", payload:{nonce, ts}}`.
 *   3. Client signs buildDeviceAuthPayloadV3(...) with its Ed25519 private key.
 *   4. Client sends a connect request frame carrying `device: {id, publicKey,
 *      signature, signedAt, nonce}` plus any shared-secret auth (token or
 *      bootstrapToken) and optionally `deviceToken` from a prior pairing.
 *   5. For local (loopback) clients, the gateway's silentLocalPairing path
 *      auto-approves on first contact and returns a `hello-ok`. No user
 *      approval needed.
 *   6. `device.pair.resolved` / `device.token.rotated` events may include a
 *      rotated deviceToken; we persist whatever token the gateway hands us so
 *      reconnects don't re-enter the pairing path.
 *
 * Stored identity lives at <data-dir>/openclaw-devices/<connector-id>.json.
 * Treat that file like a credential: 0600 on disk.
 *
 * Agent requests are `{type:"req", id, method:"agent", params:{message}}`;
 * replies come back as `{type:"res", id, ok, payload:{text|message|content}}`.
 */

const CLIENT_PROTOCOL_VERSION = 3;
const CLIENT_ID = "gateway-client"; // from GATEWAY_CLIENT_IDS
const CLIENT_MODE = "backend"; // from GATEWAY_CLIENT_MODES
const CLIENT_VERSION = "0.1.0";
const CLIENT_DISPLAY_NAME_MAX = 48;
const LANGOUSTE_SCOPES = ["operator.write", "operator.read"];

export class OpenClawAgent implements AgentConnection {
  private url: string;
  private deviceName: string;
  private sharedToken: string | undefined;
  private bootstrapToken: string | undefined;
  private identity: DeviceIdentity;
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
    this.deviceName = (config.device_name || "langouste").slice(0, CLIENT_DISPLAY_NAME_MAX);
    this.sharedToken = config.token?.trim() || undefined;
    this.bootstrapToken = config.bootstrap_token?.trim() || undefined;
    const connectorId = config.connector_id ?? "default";
    this.identity = loadOrCreateConnectorIdentity(connectorId);
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

  // --- Helpers ---

  private nextRequestId(): string {
    return `lg-${++this.requestCounter}-${Date.now().toString(36)}`;
  }

  private buildConnectFrame(challengeNonce: string, frameId: string) {
    const signedAtMs = Date.now();
    const scopes = [...LANGOUSTE_SCOPES];
    const payload = buildDeviceAuthPayloadV3({
      deviceId: this.identity.deviceId,
      clientId: CLIENT_ID,
      clientMode: CLIENT_MODE,
      role: "operator",
      scopes,
      signedAtMs,
      token: this.sharedToken ?? null,
      nonce: challengeNonce,
      platform: process.platform,
    });
    const signature = signPayload(this.identity.privateKeyPem, payload);

    const authBlock: Record<string, string> = {};
    if (this.sharedToken) authBlock.token = this.sharedToken;
    if (this.bootstrapToken) authBlock.bootstrapToken = this.bootstrapToken;
    if (this.identity.deviceToken) authBlock.deviceToken = this.identity.deviceToken;

    return {
      type: "req",
      id: frameId,
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
        scopes,
        device: {
          id: this.identity.deviceId,
          publicKey: this.identity.publicKeyPem,
          signature,
          signedAt: signedAtMs,
          nonce: challengeNonce,
        },
        ...(Object.keys(authBlock).length > 0 ? { auth: authBlock } : {}),
      },
    };
  }

  // --- Connection ---

  private connect(): Promise<WebSocket> {
    if (this.connecting) return this.connecting;

    this.setStatus("connecting", this.url);

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.url);

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close();
      }, CONNECT_TIMEOUT_MS);

      const connectId = this.nextRequestId();
      let handshakeComplete = false;

      ws.onmessage = (event) => {
        const raw = String(event.data);
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw);
        } catch {
          console.warn(`[OpenClaw] Unparseable frame: ${raw.slice(0, 200)}`);
          return;
        }
        const type = frame.type as string | undefined;

        // Phase 1: server's challenge nonce. Sign it and send our connect.
        if (
          !handshakeComplete &&
          type === "event" &&
          (frame as { event?: string }).event === "connect.challenge"
        ) {
          const payload = frame.payload as { nonce?: string } | undefined;
          if (!payload?.nonce) {
            this.connecting = null;
            ws.close();
            reject(new Error("connect.challenge missing nonce"));
            return;
          }
          const connectFrame = this.buildConnectFrame(payload.nonce, connectId);
          console.log(
            `[OpenClaw] → connect device=${this.identity.deviceId.slice(0, 12)}… role=operator`,
          );
          ws.send(JSON.stringify(connectFrame));
          return;
        }

        // Phase 2: connect response.
        if (!handshakeComplete && type === "res" && (frame as { id?: string }).id === connectId) {
          if (frame.ok) {
            handshakeComplete = true;
            const payload = frame.payload as { auth?: { deviceToken?: string } } | undefined;
            const issuedToken = payload?.auth?.deviceToken;
            if (issuedToken && issuedToken !== this.identity.deviceToken) {
              this.identity.setDeviceToken(issuedToken);
              console.log(`[OpenClaw] stored deviceToken from hello-ok`);
            }
            this.ws = ws;
            this.connecting = null;
            this.setStatus("connected", this.url);
            resolve(ws);
          } else {
            const err = frame.error as { message?: string; details?: { code?: string } } | undefined;
            const detailCode = err?.details?.code;
            const msg = err?.message ?? "Handshake rejected";
            this.connecting = null;
            this.setStatus("error", msg);
            ws.close();
            reject(
              new Error(
                `OpenClaw handshake failed: ${msg}${detailCode ? ` [${detailCode}]` : ""}`,
              ),
            );
          }
          return;
        }

        // Post-handshake events: token rotation.
        if (handshakeComplete && type === "event") {
          const eventName = (frame as { event?: string }).event;
          if (eventName === "device.token.rotated" || eventName === "device.pair.resolved") {
            const payload = frame.payload as { deviceToken?: string } | undefined;
            if (payload?.deviceToken && payload.deviceToken !== this.identity.deviceToken) {
              this.identity.setDeviceToken(payload.deviceToken);
              console.log(`[OpenClaw] persisted rotated deviceToken`);
            }
          }
          return;
        }

        // Responses to in-flight requests. The `agent` method returns twice:
        // once with `{status:"accepted", runId}` when the turn is queued, then
        // again with the same request id when the turn completes. We discard
        // the intermediate "accepted" response and wait for the final one.
        if (type !== "res" || typeof (frame as { id?: unknown }).id !== "string") return;
        const frameId = (frame as { id: string }).id;
        const pending = this.pendingRequests.get(frameId);
        if (!pending) return;

        if (frame.ok) {
          const payload = frame.payload as
            | {
                text?: string;
                message?: string;
                content?: string;
                status?: string;
                runId?: string;
                result?: { text?: string; message?: string };
                reply?: { text?: string; message?: string };
              }
            | undefined;
          // Intermediate acknowledgement — keep waiting for the real reply.
          if (payload?.status === "accepted") return;

          this.pendingRequests.delete(frameId);
          const text =
            payload?.text ??
            payload?.message ??
            payload?.content ??
            payload?.result?.text ??
            payload?.result?.message ??
            payload?.reply?.text ??
            payload?.reply?.message ??
            JSON.stringify(payload ?? {});
          pending.resolve(String(text));
        } else {
          this.pendingRequests.delete(frameId);
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
          const reason = event.reason || "unknown";
          this.setStatus("error", `Handshake closed (code=${event.code}, ${reason})`);
          reject(
            new Error(
              `OpenClaw connection closed before handshake (code=${event.code}${event.reason ? `, ${event.reason}` : ""})`,
            ),
          );
        } else if (this.statusInfo.status === "connected") {
          this.setStatus("error", `Connection lost (code=${event.code})`);
        }
      };
    });

    return this.connecting;
  }

  // --- Messaging ---

  async sendMessage(text: string): Promise<string> {
    if (this.stopped) throw new Error("OpenClaw agent has been disconnected");

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.nextRequestId();
    console.log(`[OpenClaw] sendMessage id=${id} text="${text.slice(0, 80)}…"`);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const frame = {
        type: "req",
        id,
        method: "agent",
        params: {
          message: text,
          // Required by AgentParamsSchema — unique per request so the server
          // can dedupe on retry.
          idempotencyKey: id,
          // Gateway needs one of: agentId, to, session-id. We route to the
          // default agent "main" which the user configured via `openclaw
          // agents list` (almost always present after setup).
          agentId: "main",
        },
      };
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
