import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getDueVocabulary } from "../../services/database/vocabulary.ts";
import { getDueGrammarGaps } from "../../services/database/grammar-gaps.ts";
import { recordInteraction } from "../../services/spaced-repetition/interactions.ts";

export const reviewRoutes = new Hono();

reviewRoutes.use("*", requireAuth);

// Get items due for review
reviewRoutes.get("/due/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");

  const [vocabulary, grammarGaps] = await Promise.all([
    getDueVocabulary(db, userId, language),
    getDueGrammarGaps(db, userId, language),
  ]);

  return c.json({ vocabulary, grammar_gaps: grammarGaps });
});

// Submit a vocabulary review result
reviewRoutes.post("/vocabulary/:vocabId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const vocabId = c.req.param("vocabId");
  const { quality } = await c.req.json();

  if (typeof quality !== "number" || quality < 0 || quality > 5) {
    return c.json({ error: "Quality must be 0-5" }, 400);
  }

  const row = await db.selectOne<{ language: string }>("vocabulary", {
    columns: "language",
    filters: [{ op: "eq", column: "vocab_id", value: vocabId }],
  });
  if (!row) return c.json({ error: "Vocabulary item not found" }, 404);

  await recordInteraction(db, {
    userId,
    language: row.language,
    itemType: "vocabulary",
    itemId: vocabId,
    eventType: "recall",
    quality,
    outcome: quality >= 3 ? "correct" : "incorrect",
    source: "review",
  });
  return c.json({ ok: true });
});

// Submit a grammar gap review result
reviewRoutes.post("/grammar/:gapId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const gapId = c.req.param("gapId");
  const { quality } = await c.req.json();

  if (typeof quality !== "number" || quality < 0 || quality > 5) {
    return c.json({ error: "Quality must be 0-5" }, 400);
  }

  const row = await db.selectOne<{ language: string }>("grammar_gaps", {
    columns: "language",
    filters: [{ op: "eq", column: "gap_id", value: gapId }],
  });
  if (!row) return c.json({ error: "Grammar gap not found" }, 404);

  await recordInteraction(db, {
    userId,
    language: row.language,
    itemType: "grammar",
    itemId: gapId,
    eventType: "recall",
    quality,
    outcome: quality >= 3 ? "correct" : "incorrect",
    source: "review",
  });
  return c.json({ ok: true });
});
