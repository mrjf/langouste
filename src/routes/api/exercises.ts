import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import type { Database } from "../../lib/db/index.ts";
import {
  getExerciseHistory,
  getExerciseSession,
  isExerciseKind,
  submitExerciseAttempt,
  type ExerciseSessionOptions,
} from "../../services/exercises/generator.ts";

type ExerciseRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

export const exerciseRoutes = new Hono<ExerciseRouteBindings>();

exerciseRoutes.use("*", requireAuth);

exerciseRoutes.get("/session/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language").trim();
  const limit = Number.parseInt(c.req.query("limit") ?? "8", 10);
  const deterministicQuery = c.req.query("deterministic") ?? c.req.query("deterministicOnly");
  const options: ExerciseSessionOptions = {
    targetLexemes: splitQuery(c.req.query("lexeme") ?? c.req.query("term")),
    targetConceptIds: splitQuery(c.req.query("concept")),
    targetGrammarTags: splitQuery(c.req.query("grammar")),
    exerciseKinds: splitQuery(c.req.query("kind")).filter(isExerciseKind),
    deterministicOnly: deterministicQuery == null ? undefined : deterministicQuery !== "0",
  };

  if (!language) return c.json({ error: "language is required" }, 400);
  return c.json(await getExerciseSession(db, userId, language, limit, options));
});

exerciseRoutes.get("/history/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language").trim();
  const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);

  if (!language) return c.json({ error: "language is required" }, 400);
  return c.json({ attempts: await getExerciseHistory(db, userId, language, limit) });
});

exerciseRoutes.post("/attempts/:attemptId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const attemptId = c.req.param("attemptId").trim();
  const body = await c.req.json();

  if (!attemptId) return c.json({ error: "attemptId is required" }, 400);
  try {
    return c.json(await submitExerciseAttempt(db, userId, attemptId, body.answer));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Exercise submission failed";
    const status = message.includes("not found") ? 404 : 400;
    return c.json({ error: message }, status);
  }
});

function splitQuery(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
