import { Hono } from "hono";
import type { Database } from "../../lib/db/index.ts";
import { searchCorpus, type CorpusDocumentContext } from "../../services/corpus/store.ts";
import { requireAuth } from "../middleware.ts";

type CorpusRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

const SOURCE_TYPES = new Set<CorpusDocumentContext["sourceType"]>([
  "message",
  "workbench",
  "audio",
  "audio_drill",
  "reading",
  "import",
]);

export const corpusRoutes = new Hono<CorpusRouteBindings>();
corpusRoutes.use("*", requireAuth);

corpusRoutes.get("/search", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  if (!query) return c.json({ error: "q is required" }, 400);
  if (query.length > 1_024) return c.json({ error: "q is too long" }, 400);

  const sourceTypeValue = c.req.query("source_type")?.trim();
  if (
    sourceTypeValue &&
    !SOURCE_TYPES.has(sourceTypeValue as CorpusDocumentContext["sourceType"])
  ) {
    return c.json({ error: "invalid source_type" }, 400);
  }
  const limitValue = Number.parseInt(c.req.query("limit") ?? "20", 10);
  const includeDocument = c.req.query("include_document") === "true";
  const rows = await searchCorpus(c.get("db"), query, {
    ownerId: c.get("userId"),
    language: c.req.query("language")?.trim() || undefined,
    sourceType: sourceTypeValue as CorpusDocumentContext["sourceType"] | undefined,
    limit: Number.isFinite(limitValue) ? limitValue : 20,
    includeDocument,
  });

  return c.json({
    query,
    results: rows.map((row) => ({
      document_id: row.document_id,
      source_type: row.source_type,
      source_id: row.source_id,
      conversation_id: row.conversation_id,
      language: row.language,
      title: row.title,
      text: row.text,
      tier_ids: row.tier_ids,
      search_score: row.search_score,
      ...(includeDocument ? { filo_doc: row.filo_doc } : {}),
    })),
  });
});
