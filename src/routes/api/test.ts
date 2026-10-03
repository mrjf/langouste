import { Hono } from "hono";
import { config } from "../../lib/config.ts";
import { adminDb } from "../../lib/db/index.ts";
import { drainBackgroundTasks } from "../../lib/background-tasks.ts";
import { testRegistry } from "../../lib/test-registry.ts";
import { disconnectAgent } from "../../services/agents/factory.ts";

/**
 * Test-only endpoints. Mounted only when config.testMode is true; callers
 * that hit these in production will get 404 because the route isn't
 * registered at all.
 */

export const testRoutes = new Hono();

// Belt-and-braces: reject if somehow mounted outside test mode.
testRoutes.use("*", async (c, next) => {
  if (!config.testMode) return c.json({ error: "Test mode not enabled" }, 404);
  await next();
});

// Register stub responses.
testRoutes.post("/agent/reply", async (c) => {
  const { prompt, reply, default: isDefault } = await c.req.json();
  if (isDefault) {
    testRegistry.setDefaultAgentReply(reply);
  } else {
    testRegistry.setAgentReply(prompt, reply);
  }
  return c.json({ ok: true });
});

testRoutes.post("/ai/explain", async (c) => {
  const { text, response, default: isDefault } = await c.req.json();
  if (isDefault) {
    testRegistry.setDefaultExplainResponse(response);
  } else {
    testRegistry.setExplainResponse(text, response);
  }
  return c.json({ ok: true });
});

testRoutes.post("/ai/vocab", async (c) => {
  const { text, response, default: isDefault } = await c.req.json();
  if (isDefault) {
    testRegistry.setDefaultVocabResponse(response);
  } else {
    testRegistry.setVocabResponse(text, response);
  }
  return c.json({ ok: true });
});

testRoutes.post("/ai/translate", async (c) => {
  const { text, target_language, translation } = await c.req.json();
  testRegistry.setTranslation(text, target_language, translation);
  return c.json({ ok: true });
});

// Wipe all registered stubs.
testRoutes.post("/reset-stubs", async (c) => {
  testRegistry.reset();
  return c.json({ ok: true });
});

// Wipe all data except schema. Used between test files when we want a
// clean DB without tearing down the whole server.
testRoutes.post("/reset-db", async (c) => {
  await drainBackgroundTasks();
  const db = adminDb();
  // Order matters for FKs even with ON DELETE CASCADE: empty the leaves first.
  const tables = [
    "review_log",
    "concept_srs",
    "fsrs_configs",
    "messages",
    "conversation_members",
    "conversations",
    "agent_connectors",
    "vocabulary",
    "grammar_gaps",
    "assessments",
    "profiles",
    "users",
  ];
  for (const t of tables) {
    try {
      if (!db.clear) throw new Error("database does not expose test reset");
      await db.clear(t);
    } catch (err) {
      console.error(`[test] failed to clear ${t}:`, err);
    }
  }
  return c.json({ ok: true });
});

// Drop the cached agent factory entries — forces fresh construction on next
// use. Needed after stub-response changes that should take effect immediately.
testRoutes.post("/reset-agents", async (c) => {
  const { connector_ids } = await c.req.json<{ connector_ids?: string[] }>();
  if (connector_ids?.length) {
    for (const id of connector_ids) disconnectAgent(id);
  }
  return c.json({ ok: true });
});

// Introspection for tests.
testRoutes.get("/db/:table", async (c) => {
  const table = c.req.param("table");
  const allowed = new Set([
    "users",
    "profiles",
    "agent_connectors",
    "conversations",
    "conversation_members",
    "messages",
    "vocabulary",
    "grammar_gaps",
    "concept_srs",
    "fsrs_configs",
    "assessments",
    "review_log",
  ]);
  if (!allowed.has(table)) return c.json({ error: "unknown table" }, 400);
  const rows = await adminDb().select(table);
  return c.json(rows);
});
