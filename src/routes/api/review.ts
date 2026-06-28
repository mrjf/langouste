import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getDueVocabulary } from "../../services/database/vocabulary.ts";
import { getDueGrammarGaps } from "../../services/database/grammar-gaps.ts";
import { getFSRSConfig, upsertFSRSConfig } from "../../services/spaced-repetition/config.ts";
import { recordInteraction } from "../../services/spaced-repetition/interactions.ts";
import { tuneFSRSInteractionWeights } from "../../services/spaced-repetition/tuning.ts";
import type { AuthenticatedRouteBindings } from "../types.ts";

export const reviewRoutes = new Hono<AuthenticatedRouteBindings>();

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

// Inspect effective FSRS parameters + interaction quality weights.
reviewRoutes.get("/fsrs/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");

  return c.json(await getFSRSConfig(db, userId, language));
});

// Patch per-language FSRS parameters or signal weights.
reviewRoutes.patch("/fsrs/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");
  const body = await c.req.json();

  try {
    return c.json(await upsertFSRSConfig(db, userId, language, body));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid FSRS config" }, 400);
  }
});

// Tune interaction signal quality weights from review_log evidence.
reviewRoutes.post("/fsrs/:language/tune", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");
  const body = await c.req.json().catch(() => ({}));

  try {
    return c.json(
      await tuneFSRSInteractionWeights(db, userId, language, {
        minEvidence: typeof body.min_evidence === "number" ? body.min_evidence : undefined,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        dryRun: body.dry_run !== false,
      }),
    );
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "FSRS tuning failed" }, 400);
  }
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
