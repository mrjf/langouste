import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getDueVocabulary, reviewVocabulary } from "../../services/database/vocabulary.ts";
import { getDueGrammarGaps, reviewGrammarGap } from "../../services/database/grammar-gaps.ts";

export const reviewRoutes = new Hono();

reviewRoutes.use("*", requireAuth);

// Get items due for review
reviewRoutes.get("/due/:language", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const language = c.req.param("language");

  const [vocabulary, grammarGaps] = await Promise.all([
    getDueVocabulary(supabase, userId, language),
    getDueGrammarGaps(supabase, userId, language),
  ]);

  return c.json({ vocabulary, grammar_gaps: grammarGaps });
});

// Submit a vocabulary review result
reviewRoutes.post("/vocabulary/:vocabId", async (c) => {
  const supabase = c.get("supabase");
  const vocabId = c.req.param("vocabId");
  const { quality } = await c.req.json();

  if (typeof quality !== "number" || quality < 0 || quality > 5) {
    return c.json({ error: "Quality must be 0-5" }, 400);
  }

  await reviewVocabulary(supabase, vocabId, quality);
  return c.json({ ok: true });
});

// Submit a grammar gap review result
reviewRoutes.post("/grammar/:gapId", async (c) => {
  const supabase = c.get("supabase");
  const gapId = c.req.param("gapId");
  const { quality } = await c.req.json();

  if (typeof quality !== "number" || quality < 0 || quality > 5) {
    return c.json({ error: "Quality must be 0-5" }, 400);
  }

  await reviewGrammarGap(supabase, gapId, quality);
  return c.json({ ok: true });
});
