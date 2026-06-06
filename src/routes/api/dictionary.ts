import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { lookupDictionary } from "../../services/references/dictionary.ts";
import { getItemReference } from "../../services/references/item-reference.ts";
import { getAudioProvider } from "../../services/ai/audio/index.ts";
import { translateTexts } from "../../services/ai/translator.ts";
import {
  findAudioAssetForRequest,
  storeAudioAsset,
  type CachedAudioAsset,
} from "../../services/corpus/audio-assets.ts";
import { recordInteraction } from "../../services/spaced-repetition/interactions.ts";
import { normalizeVocabularyTerm } from "../../services/spaced-repetition/vocabulary-normalizer.ts";
import { adminDb } from "../../lib/db/index.ts";
import type { Database } from "../../lib/db/index.ts";
import type { LanguageCode } from "../../types/index.ts";

type DictionaryRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

export const dictionaryRoutes = new Hono<DictionaryRouteBindings>();

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
    await recordVocabularyAudio(c.get("db"), userId, term, language);
    return c.redirect(wiktionaryAudio, 302);
  }

  const provider = getAudioProvider();
  if (!provider.isAvailable()) {
    return c.json({ error: "No Wiktionary audio and no TTS provider configured" }, 404);
  }

  try {
    const assetDb = adminDb();
    const cached = await findAudioAssetForRequest(assetDb, {
      provider: provider.name,
      language,
      text: term,
    }).catch(() => null);
    if (cached) {
      await recordVocabularyAudio(c.get("db"), userId, term, language);
      return audioAssetResponse(cached);
    }
    const result = await provider.synthesize(term, { language, userId });
    const asset = await storeAudioAsset(assetDb, {
      provider: provider.name,
      language,
      text: term,
      audio: result.audio,
      contentType: result.contentType,
    });
    await recordVocabularyAudio(c.get("db"), userId, term, language);
    return audioAssetResponse(asset);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: detail }, 502);
  }
});

function audioAssetResponse(asset: CachedAudioAsset): Response {
  const audioBody = new ArrayBuffer(asset.audio.byteLength);
  new Uint8Array(audioBody).set(asset.audio);
  return new Response(audioBody, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(asset.audio.byteLength),
      "X-Langouste-Audio-Id": asset.audioId,
    },
  });
}

dictionaryRoutes.get("/", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  const language = (c.req.query("language") ?? "").trim();
  const shouldRecordSeen = c.req.query("record_seen") === "1";
  if (!term || !language) return c.json({ error: "term and language are required" }, 400);
  if (term.length > 80) return c.json({ error: "term is too long" }, 400);

  try {
    const lookup = await lookupDictionary(term, language);
    if (shouldRecordSeen) {
      await recordVocabularySeen(
        c.get("db"),
        c.get("userId"),
        term,
        language,
        lookup.definitions[0],
      );
    }
    return c.json(lookup);
  } catch (err) {
    console.error("dictionary lookup failed:", err);
    return c.json({ error: "Dictionary lookup failed" }, 502);
  }
});

async function recordVocabularySeen(
  db: Database,
  userId: string,
  term: string,
  language: string,
  translation?: string,
): Promise<void> {
  await recordVocabularyInteraction(db, userId, term, language, "encounter", "dictionary_page", {
    translation,
  });
}

async function recordVocabularyAudio(
  db: Database,
  userId: string,
  term: string,
  language: string,
): Promise<void> {
  await recordVocabularyInteraction(db, userId, term, language, "heard", "dictionary_audio");
}

async function recordVocabularyInteraction(
  db: Database,
  userId: string,
  term: string,
  language: string,
  eventType: "encounter" | "heard",
  source: "dictionary_page" | "dictionary_audio",
  seed: { translation?: string } = {},
): Promise<void> {
  try {
    const normalized = await normalizeVocabularyTerm(term, language);
    await recordInteraction(db, {
      userId,
      language: language as LanguageCode,
      itemType: "vocabulary",
      lookupKey: normalized.term,
      seed:
        seed.translation || normalized.definition
          ? { translation: seed.translation ?? normalized.definition ?? "" }
          : undefined,
      eventType,
      source,
    });
  } catch (err) {
    console.error("dictionary vocabulary tracking failed:", err);
  }
}

dictionaryRoutes.get("/translations", async (c) => {
  const term = (c.req.query("term") ?? "").trim();
  const sourceLanguage = (c.req.query("source_language") ?? "").trim();
  const targetLanguage = (c.req.query("target_language") ?? "").trim();
  if (!term || !sourceLanguage || !targetLanguage) {
    return c.json({ error: "term, source_language, and target_language are required" }, 400);
  }
  if (term.length > 80) return c.json({ error: "term is too long" }, 400);

  try {
    const lookup = await lookupDictionary(term, sourceLanguage);
    const sourceTerm = lookup.source_term ?? term;
    const glosses = lookup.definitions.slice(0, 5);
    const texts = glosses.length > 0 ? glosses : [sourceTerm];
    const translations =
      targetLanguage === "en" ? texts : await translateTexts(texts, targetLanguage);

    return c.json({
      term,
      source_language: sourceLanguage,
      target_language: targetLanguage,
      source_term: sourceTerm,
      source_definition_language: "en",
      source_glosses: glosses,
      equivalents: translations.filter((value) => value.trim().length > 0),
      source: targetLanguage === "en" ? "wiktionary-gloss" : "wiktionary-gloss-translation",
    });
  } catch (err) {
    console.error("dictionary translation failed:", err);
    return c.json({ error: "Dictionary translation failed" }, 502);
  }
});
