# External References

Every correction, every vocabulary item, every grammar concept should be one tap from an authoritative external explanation. This doc is the catalogue of sources, the URL templates we use to deep-link to them, and the ingestion pipelines for the bulk assets (CEFR vocabulary lists, concept seed data).

## Design principles

1. **Link, don't embed.** Embedding excerpts puts us in licensing purgatory. Every external source here is free to link to; most have copyright-encumbered content.
2. **Deterministic URL templates over scraping.** A template we can compute from a term or concept is stable. A scrape that breaks the moment Lingolia redesigns is a maintenance tax forever.
3. **Multiple sources per concept.** One URL will 404. Three won't. We show up to three "learn more" chips per correction, sourced from different providers.
4. **A healthcheck for every template.** Weekly cron pings each template with canonical test inputs; flags stale templates before a user ever sees a 404.
5. **Prefer CC-licensed content for ingestion.** Wiktionary (CC-BY-SA), Tatoeba (CC-BY), FrequencyWords (MIT) for anything we store server-side.

## Per-concept URL templates

Stored in `assets/reference-templates.json`, loaded at boot into a registry service. Each template takes a few inputs (language, lemma, concept-id) and emits a URL.

### Primary: Wiktionary

The default first link. Generous rate limits (≈200 req/s with a User-Agent), CC-BY-SA, stable URL structure across languages, multilingual via per-language subdomains.

| Use case | Template |
|---|---|
| Word entry (any language) | `https://en.wiktionary.org/wiki/{lemma}` |
| Entry in target-language Wiktionary | `https://{lang}.wiktionary.org/wiki/{lemma}` |
| Conjugation section anchor | `https://en.wiktionary.org/wiki/{lemma}#Conjugation` |
| Declension section anchor | `https://en.wiktionary.org/wiki/{lemma}#Declension` |
| MediaWiki API (lookup, audio, IPA) | `https://en.wiktionary.org/w/api.php?action=parse&page={lemma}&format=json` |

### Per-language grammar concept maps

Every language gets a YAML map from `concept_id` → curated external URLs. Populated by hand (fundamentally a curation job) and reviewed quarterly.

`assets/concepts/fr.yaml` (excerpt):

```yaml
fr:verb:passe-compose-etre:
  name: "Passé composé with être"
  cefr: A2
  refs:
    - source: kwiziq
      url: https://french.kwiziq.com/revision/grammar/when-to-use-etre-as-the-auxiliary-verb-in-le-passe-compose
    - source: lawless
      url: https://www.lawlessfrench.com/grammar/etre-verbs/
    - source: lingolia
      url: https://francais.lingolia.com/en/grammar/tenses/passe-compose

fr:gender:articles:
  name: "Gendered articles (le/la/les)"
  cefr: A1
  refs:
    - source: lawless
      url: https://www.lawlessfrench.com/grammar/gender-of-nouns/
    - source: lingolia
      url: https://francais.lingolia.com/en/grammar/nouns-and-articles/gender
```

v1 ships curated maps for: French, German, Spanish, Italian, Portuguese, Hungarian, Dutch. Longer-tail languages (Polish, Turkish, Russian, Arabic) get Wiktionary-only defaults until curated.

### Per-language conjugation deeplinks

| Language | Primary | Fallback |
|---|---|---|
| French | `https://conjugator.reverso.net/conjugation-french-verb-{verb}.html` | `https://cooljugator.com/fr/{verb}` |
| Spanish | `https://conjugator.reverso.net/conjugation-spanish-verb-{verb}.html` | `https://cooljugator.com/es/{verb}` |
| German | `https://conjugator.reverso.net/conjugation-german-verb-{verb}.html` | `https://cooljugator.com/de/{verb}` |
| Italian | `https://cooljugator.com/it/{verb}` | `https://en.wiktionary.org/wiki/{verb}#Conjugation` |
| Portuguese | `https://cooljugator.com/pt/{verb}` | `https://en.wiktionary.org/wiki/{verb}#Conjugation` |
| Hungarian | `https://cooljugator.com/hu/{verb}` | `https://hungarianreference.com/verbs/` |
| Dutch | `https://cooljugator.com/nl/{verb}` | `https://en.wiktionary.org/wiki/{verb}#Conjugation` |

All of these are scrape-hostile but linkable. Our users get a browser tab; we don't proxy.

### Dictionary usage examples

| Source | URL template | Notes |
|---|---|---|
| WordReference | `https://www.wordreference.com/fren/{term}` (`/enfr/`, `/fres/`, etc.) | Stable, free, trusted |
| Linguee | `https://www.linguee.com/{src}-{tgt}/translation/{term}.html` | Bilingual examples, DeepL-owned, link-only |
| Reverso Context | `https://context.reverso.net/translation/{src}-{tgt}/{term}` | URL-encoded phrase |
| Tatoeba (example sentences) | `https://tatoeba.org/en/sentences/search?from={lang3}&to={l1_lang3}&query={term}` | CC-BY, has API |

`lang3` is ISO 639-3 (`fra`, `spa`, `deu`). We keep a short ISO 639-1 ↔ 639-3 map.

### Pronunciation / audio

| Source | URL template | Notes |
|---|---|---|
| Forvo | `https://forvo.com/word/{term}/#{lang}` | Free to link. API requires key (500 req/day free) |
| Wiktionary audio | Via MediaWiki API `prop=imageinfo`, then the Ogg URL | CC-licensed |
| Wikipedia IPA help page | `https://en.wikipedia.org/wiki/Help:IPA/{Language_Name}` | Reliable reference for phoneme symbols |

### Beyond CEFR-aligned systems

| System | Source | Use |
|---|---|---|
| ACTFL | `https://www.actfl.org/educator-resources/actfl-proficiency-guidelines` | Reference only, copyrighted |
| JLPT (Japanese) | `https://www.jlpt.jp/e/` (official), GitHub mirrors (`jonsafari/jlpt-resources`) for ingestible lists | If we ever add Japanese |
| HSK (Mandarin) | `http://www.chinesetest.cn/` (official), `glxxyz/hskhsk.com` on GitHub | If we ever add Mandarin |

## Bulk ingestion

Not every reference is a link — some become our own data.

### CEFR-aligned vocabulary

The gold standard would be Council of Europe Reference Level Descriptions (English Profile, Profile Deutsch, Un Référentiel FR). Only partially free. What we actually use:

1. **English Profile** — `https://www.englishprofile.org/wordlists/evp` — free download. ~7000 English lemmas with CEFR tags.
2. **hermitdave/FrequencyWords** on GitHub — MIT-licensed OpenSubtitles-derived frequency lists for 60+ languages. We bucket by frequency percentile to proxy CEFR (top 2k ≈ A1, top 5k ≈ A2, top 10k ≈ B1, top 20k ≈ B2, rest ≈ C).
3. **Kelly Project lists** — CC-BY-SA, 9 languages. Slovak National Corpus download. More rigorous than frequency buckets but narrower coverage.

Pipeline:

```
bun scripts/ingest-cefr-wordlists.ts
  --source=frequencywords --language=fr
  --source=english-profile --language=en
  --output=seed_data/vocabulary_cefr.jsonl
```

Output rows get loaded into a `cefr_wordlists` table keyed by `(language, lemma)`. Used by the CEFR estimator feature extractor (median lexical rarity) and to tag new vocabulary in real time.

### Concept catalog seed

The `concepts` table (see `docs/LEARNING-MODEL.md`) is seeded from the YAML maps in `assets/concepts/<lang>.yaml`. A migration script ensures concept IDs are stable across restarts so user progress doesn't get orphaned when we add new concepts.

### Tatoeba for example sentences

Tatoeba provides a nightly dump at `https://downloads.tatoeba.org/exports/sentences.tar.bz2`. We ingest weekly into a local `example_sentences` table, indexed by language and lemma. Used for "here's how this word is actually used" cards in review mode.

Attribution: every Tatoeba sentence carries a CC-BY attribution. Render it in the UI on the card: "Example from Tatoeba, contributor `username`."

## The reference-links service

Tiny, stateless module that takes a `Correction` and returns up to three link chips.

```typescript
interface ReferenceLink {
  source: "wiktionary" | "kwiziq" | "lingolia" | "lawless" | "cooljugator" | "tatoeba" | "wordreference";
  url: string;
  label: string;       // e.g., "Passé composé (Kwiziq)"
  trust: number;       // 0–1, how confident we are this URL resolves
}

async function linksForCorrection(
  correction: Correction,
  l1: string,
  l2: string,
): Promise<ReferenceLink[]>;
```

Resolution order:

1. If `correction.concept_id` resolves to an entry in `concepts.reference_urls`, use those (up to 2).
2. If the correction's lemma is a verb, append a Cooljugator / Reverso conjugator link.
3. Otherwise append a Wiktionary entry link.
4. Always append a Tatoeba example-search link as the third slot.
5. Healthcheck-cached 404s are skipped silently.

Result is cached into `reference_links` table keyed by `correction_id` so the URLs don't recompute on every fetch and the healthcheck has a surface to scan.

## The weekly healthcheck job

`scripts/check-reference-templates.ts`:

1. For each template in the registry, pick 3 canonical inputs (verb, noun, concept) and render the URLs.
2. Fire `HEAD` requests with a realistic User-Agent. Ignore 403 (many sites block Python-default UA).
3. If a template's success rate drops below 70%, flag in the `reference_health` table and in the nightly admin email.
4. If Wiktionary/Tatoeba/MediaWiki API response rates drop sharply, alert separately — those are upstream incidents, not our code.

The point: we find out before the user does.

## License and attribution

Sources we link to: no attribution needed beyond standard hyperlinks (Kwiziq, Lingolia, Lawless, Reverso, etc.).

Sources we ingest:

| Source | License | Attribution requirement |
|---|---|---|
| Wiktionary / Wikipedia | CC-BY-SA 4.0 | Credit "Wiktionary" + link on any derived UI |
| Tatoeba | CC-BY 2.0 FR | Credit contributor username + link per sentence |
| FrequencyWords | MIT | Credit "hermitdave/FrequencyWords" in about page |
| Kelly Project | CC-BY-SA | Credit on about page |
| English Profile | Cambridge — free download, non-commercial redistribution restricted | Link to source, don't redistribute the list |

The about page in the app lists every ingested source with license and link. Not optional.

## Future: Langouste's own reference content

Long-term, we generate per-concept reference pages that are multilingual-aware and L1-sensitive — the kind of explanation we want learners to see but no single source currently provides. Not v1. But the schema supports it: `concepts.reference_urls` can include `{source: "langouste", url: "/ref/fr:verb:passe-compose-etre"}` alongside the external ones. We'd just need to write the pages.
