import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { lookupDictionary } from "../../services/references/dictionary.ts";
import { getItemReference } from "../../services/references/item-reference.ts";
import { getAudioProvider } from "../../services/ai/audio/index.ts";

export const dictionaryRoutes = new Hono();

dictionaryRoutes.use("*", requireAuth);

dictionaryRoutes.get("/audio", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  const language = (c.req.query("language") ?? "").trim();
  const userId = c.get("userId");
  if (!term || !language) return c.json({ error: "term and language are required" }, 400);
  if (term.length > 80) return c.json({ error: "term is too long" }, 400);

  const reference = await getItemReference(term, language).catch(() => null);
  const wiktionaryAudio = reference?.pronunciations.find((p) => p.kind === "audio" && p.url)?.url;
  if (wiktionaryAudio) {
    return c.redirect(wiktionaryAudio, 302);
  }

  const provider = getAudioProvider();
  if (!provider.isAvailable()) {
    return c.json({ error: "No Wiktionary audio and no TTS provider configured" }, 404);
  }

  try {
    const result = await provider.synthesize(term, { language, userId });
    return new Response(result.audio, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(result.audio.byteLength),
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: detail }, 502);
  }
});

dictionaryRoutes.get("/", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  const language = (c.req.query("language") ?? "").trim();
  if (!term || !language) return c.json({ error: "term and language are required" }, 400);
  if (term.length > 80) return c.json({ error: "term is too long" }, 400);

  try {
    return c.json(await lookupDictionary(term, language));
  } catch (err) {
    console.error("dictionary lookup failed:", err);
    return c.json({ error: "Dictionary lookup failed" }, 502);
  }
});
