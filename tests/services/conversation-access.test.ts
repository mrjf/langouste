import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Route-level access-control tests. These boot the real message and
// conversation Hono routes against a real sqlite database and assert the
// conversation-membership gates hold: no token -> 401, valid token but not a
// member -> 403, member -> 200.
//
// The database layer is a process-wide singleton keyed off LANGOUSTE_DATA_DIR
// at first use (src/lib/db/index.ts), so we set one temp data dir for the whole
// file and give each test unique users/conversations rather than resetting the
// DB between tests. All app modules are imported dynamically *inside* helpers so
// config.ts (which reads process.env at load time) sees the env set in beforeAll.

let rootDir = "";
const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "DATABASE_MODE",
  "LANGOUSTE_JWT_SECRET",
  "LANGOUSTE_DATA_DIR",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.ANTHROPIC_API_KEY ||= "test-key";
  process.env.DATABASE_MODE = "sqlite";
  process.env.LANGOUSTE_JWT_SECRET = "test-secret";
  rootDir = await mkdtemp(join(tmpdir(), "langouste-access-"));
  process.env.LANGOUSTE_DATA_DIR = join(rootDir, "db");
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(rootDir, { recursive: true, force: true });
});

// signup() creates the `users` row and returns a signed session token, but does
// not create a `profiles` row — and conversations/members/connectors all FK to
// profiles(user_id). Seed both.
async function seedUser(email: string): Promise<{ token: string; userId: string }> {
  const { signup } = await import("../../src/lib/auth/local.ts");
  const { adminDb } = await import("../../src/lib/db/index.ts");
  const session = await signup(email, "password-123456");
  await adminDb().insert("profiles", {
    user_id: session.user.id,
    display_name: email,
    base_language: "en",
    learning_languages: [],
  });
  return { token: session.access_token, userId: session.user.id };
}

async function seedConversation(ownerId: string): Promise<string> {
  const { createConversation } = await import("../../src/services/database/conversations.ts");
  const { addMember } = await import("../../src/services/database/members.ts");
  const { adminDb } = await import("../../src/lib/db/index.ts");
  const conversation = await createConversation(adminDb(), ownerId);
  await addMember(adminDb(), {
    conversation_id: conversation.conversation_id,
    user_id: ownerId,
    target_languages: [{ lang: "hu", cefr_level: "A1" }],
    base_languages: ["en"],
  });
  return conversation.conversation_id;
}

async function seedConnector(ownerId: string): Promise<string> {
  const { adminDb } = await import("../../src/lib/db/index.ts");
  const connector = await adminDb().insert<{ connector_id: string }>("agent_connectors", {
    name: "test-connector",
    type: "stub",
    config: {},
    created_by: ownerId,
  });
  return connector.connector_id;
}

describe("conversation access control", () => {
  test("GET /messages/:conversationId enforces membership", async () => {
    const { messageRoutes } = await import("../../src/routes/api/messages.ts");
    const member = await seedUser("member-a@test");
    const outsider = await seedUser("outsider-a@test");
    const conversationId = await seedConversation(member.userId);
    const url = `http://local/${conversationId}`;

    const noAuth = await messageRoutes.request(url);
    expect(noAuth.status).toBe(401);

    const nonMember = await messageRoutes.request(url, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(nonMember.status).toBe(403);

    const asMember = await messageRoutes.request(url, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(asMember.status).toBe(200);
    expect(Array.isArray(await asMember.json())).toBe(true);
  });

  test("PATCH /conversations/:conversationId/connector enforces membership", async () => {
    const { conversationRoutes } = await import("../../src/routes/api/conversations.ts");
    const member = await seedUser("member-b@test");
    const outsider = await seedUser("outsider-b@test");
    const conversationId = await seedConversation(member.userId);
    // The outsider owns the target connector (so they pass the ownership check)
    // but is not a member of the conversation (so they must be rejected).
    const outsiderConnectorId = await seedConnector(outsider.userId);
    const url = `http://local/${conversationId}/connector`;
    const init = {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_connector_id: outsiderConnectorId }),
    };

    const noAuth = await conversationRoutes.request(url, init);
    expect(noAuth.status).toBe(401);

    const nonMember = await conversationRoutes.request(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${outsider.token}` },
    });
    expect(nonMember.status).toBe(403);
  });
});
