/**
 * Per-connector Ed25519 device identity for OpenClaw pairing. Mirrors the
 * structure of OpenClaw's own identity file at ~/.openclaw/identity/device.json
 * so the protocol's verify path matches bit-for-bit.
 *
 * Reverse-engineered from:
 *   /usr/local/lib/node_modules/openclaw/dist/device-identity-*.js
 *   /usr/local/lib/node_modules/openclaw/dist/method-scopes-*.js
 *
 * Canonical auth payload (v3):
 *   "v3|<deviceId>|<clientId>|<clientMode>|<role>|<scopes joined by ,>|
 *    <signedAtMs>|<token or empty>|<nonce>|<platform>|<deviceFamily>"
 *   where all metadata strings are trim+lowercase-ASCII.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureDataSubdir } from "../../lib/data-dir.ts";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface DeviceIdentityFile {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  /** Token returned by the gateway after successful pairing; filled on first connect. */
  deviceToken?: string;
  createdAtMs: number;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyBase64Url: string;
  deviceToken: string | undefined;
  /** Persist an updated deviceToken atomically; writes through to disk. */
  setDeviceToken(token: string): void;
}

/**
 * Load or create a device identity keyed by connector_id. The file lives
 * under <data-dir>/openclaw-devices/<connector-id>.json.
 */
export function loadOrCreateConnectorIdentity(connectorId: string): DeviceIdentity {
  const dir = ensureDataSubdir("openclaw-devices");
  const path = join(dir, `${sanitizeId(connectorId)}.json`);

  let stored = readIdentityFile(path);
  if (!stored) {
    const { publicKeyPem, privateKeyPem } = generatePem();
    stored = {
      version: 1,
      deviceId: fingerprint(publicKeyPem),
      publicKeyPem,
      privateKeyPem,
      createdAtMs: Date.now(),
    };
    writeIdentityFile(path, stored);
  } else {
    // Belt-and-braces: derive deviceId from the stored public key and fix if drifted.
    const derived = fingerprint(stored.publicKeyPem);
    if (derived !== stored.deviceId) {
      stored = { ...stored, deviceId: derived };
      writeIdentityFile(path, stored);
    }
  }

  const publicKeyBase64Url = publicKeyRawBase64Url(stored.publicKeyPem);
  const identity: DeviceIdentity = {
    deviceId: stored.deviceId,
    publicKeyPem: stored.publicKeyPem,
    privateKeyPem: stored.privateKeyPem,
    publicKeyBase64Url,
    deviceToken: stored.deviceToken,
    setDeviceToken(token: string) {
      stored!.deviceToken = token;
      identity.deviceToken = token;
      writeIdentityFile(path, stored!);
    },
  };
  return identity;
}

// --- payload + signing ---

export interface AuthPayloadInput {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}

export function buildDeviceAuthPayloadV3(input: AuthPayloadInput): string {
  const scopes = [...input.scopes].join(",");
  const token = input.token ?? "";
  const platform = normalizeMeta(input.platform);
  const deviceFamily = normalizeMeta(input.deviceFamily);
  return [
    "v3",
    input.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    scopes,
    String(input.signedAtMs),
    token,
    input.nonce,
    platform,
    deviceFamily,
  ].join("|");
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = ed25519Sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

// --- helpers ---

function normalizeMeta(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // ASCII-only lowercase, matching the gateway's toLowerAscii.
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function generatePem(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function fingerprint(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return createHash("sha256").update(raw).digest("hex");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readIdentityFile(path: string): DeviceIdentityFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as DeviceIdentityFile;
    if (
      parsed.version !== 1 ||
      typeof parsed.deviceId !== "string" ||
      typeof parsed.publicKeyPem !== "string" ||
      typeof parsed.privateKeyPem !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeIdentityFile(path: string, data: DeviceIdentityFile): void {
  mkdirSync(dirname(path), { recursive: true });
  // 0600 — the private key lives in this file.
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
