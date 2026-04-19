import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeviceAuthPayloadV3,
  loadOrCreateConnectorIdentity,
  signPayload,
} from "../../src/services/agents/openclaw-identity.ts";
import { verify as ed25519Verify, createPublicKey } from "node:crypto";

describe("openclaw-identity", () => {
  test("buildDeviceAuthPayloadV3 produces the pipe-joined v3 format", () => {
    const p = buildDeviceAuthPayloadV3({
      deviceId: "abc123",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      signedAtMs: 1000,
      token: "tkn",
      nonce: "nonce-xyz",
      platform: "Darwin",
    });
    expect(p).toBe(
      "v3|abc123|gateway-client|backend|operator|operator.read,operator.write|1000|tkn|nonce-xyz|darwin|",
    );
  });

  test("buildDeviceAuthPayloadV3 normalises metadata to trim + ASCII-lowercase", () => {
    const p = buildDeviceAuthPayloadV3({
      deviceId: "d",
      clientId: "c",
      clientMode: "m",
      role: "r",
      scopes: [],
      signedAtMs: 0,
      token: null,
      nonce: "n",
      platform: "  MacOS  ",
      deviceFamily: " iPhone ",
    });
    // Note: empty scopes stay empty, token becomes empty string.
    expect(p).toBe("v3|d|c|m|r||0||n|macos|iphone");
  });

  test("signPayload produces an Ed25519 signature that verifies against the public key", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oc-id-test-"));
    try {
      process.env.LANGOUSTE_DATA_DIR = tmp;
      const id = loadOrCreateConnectorIdentity("unit-test");
      const payload = "hello world";
      const sig = signPayload(id.privateKeyPem, payload);

      // Convert base64url signature to buffer and verify with node's Ed25519.
      const normalized = sig.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const sigBuf = Buffer.from(padded, "base64");

      const key = createPublicKey(id.publicKeyPem);
      const ok = ed25519Verify(null, Buffer.from(payload), key, sigBuf);
      expect(ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      delete process.env.LANGOUSTE_DATA_DIR;
    }
  });

  test("loadOrCreateConnectorIdentity is stable across calls for the same connector id", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oc-id-test-"));
    try {
      process.env.LANGOUSTE_DATA_DIR = tmp;
      const a = loadOrCreateConnectorIdentity("persist");
      const b = loadOrCreateConnectorIdentity("persist");
      expect(a.deviceId).toBe(b.deviceId);
      expect(a.publicKeyPem).toBe(b.publicKeyPem);
      expect(a.privateKeyPem).toBe(b.privateKeyPem);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      delete process.env.LANGOUSTE_DATA_DIR;
    }
  });

  test("setDeviceToken persists through reload", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oc-id-test-"));
    try {
      process.env.LANGOUSTE_DATA_DIR = tmp;
      const a = loadOrCreateConnectorIdentity("rotation");
      a.setDeviceToken("dev-token-abc");
      const b = loadOrCreateConnectorIdentity("rotation");
      expect(b.deviceToken).toBe("dev-token-abc");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      delete process.env.LANGOUSTE_DATA_DIR;
    }
  });
});
