import "./_db-harness.ts"; // side-effect: selects the shared in-memory storage double
import { describe, expect, test } from "bun:test";

// Route-level access-control tests. These boot the real message and
// conversation Hono routes against the Database contract double and assert the
// conversation-membership gates hold: no token -> 401, valid token but not a
// member -> 403, member -> 200.
//
// The database layer is a process-wide singleton (src/lib/db/index.ts), so each
// test uses unique users/conversations rather than resetting shared state. App
// modules are imported dynamically inside helpers so config.ts sees the harness
// environment first.

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
