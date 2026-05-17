# Language Skill Ontology

"Knowing a language" is not one thing. It's a layered stack of sub-skills, and a learner can be strong in some and weak in others. Our current data model (`vocabulary` + `grammar_gaps`) collapses all of this into two tables, which is why progress feels coarse and recommendations feel generic.

This doc is the first-class ontology: the dimensions of language proficiency we track, what belongs in each, how we measure a user's state in each, and how the measurement drives behaviour. It's the source of truth for schema, for UI, for the `learner_profile` MCP tool, and for the system prompts we send to Claude.

**The ontology sits on top of established universal standards** rather than inventing its own. Concepts are expressed using Universal Dependencies (UD) + UniMorph feature inventories, Concepticon for lexis, and PHOIBLE + PanPhon for phonology. This is load-bearing — without a universal backbone, per-language silos can never aggregate or compare, and cross-language transfer becomes invisible. See `docs/PARSING.md` for the deterministic extraction pipeline.

Grounded in: CEFR and Bachman & Palmer's communicative language ability model (1996) for the pedagogical frame; UD v2 (universaldependencies.org) for the syntactic/morphological feature backbone; UniMorph (unimorph.github.io) for paradigm data; Concepticon (concepticon.clld.org) for lexical concepts; PHOIBLE (phoible.org) for phonological inventories.

## The seven dimensions

Any natural language utterance exists at seven levels simultaneously. Competence means handling all seven. Skipping one means the other six don't quite land. Each dimension anchors to a universal standard (or stays language-specific where no universal exists).

| Dim | Scope | Universal backbone |
|---|---|---|
| **Phonology** | Sound system: phonemes, stress, intonation, liaison | PHOIBLE inventories + PanPhon articulatory features |
| **Orthography** | Writing system, spelling conventions, punctuation | Per-language; no universal inventory |
| **Morphology** | Word structure: inflection, derivation | UD features (24 universals) + UniMorph paradigms |
| **Syntax** | Sentence structure: agreement, word order, subordination | UD dependency relations (37 universals) + UD features |
| **Lexis** | Vocabulary: individual words, phrases, collocations | Concepticon concept sets (~4,400) + per-language lemma set |
| **Pragmatics** | Meaning in context: speech acts, implicature, politeness | Language-specific; no usable universal |
| **Discourse** | Multi-sentence organisation: cohesion, coherence, register | UD discourse relations (thin) + language-specific |

Sociolinguistic competence (regional/social variation) cuts across all seven. We treat it as metadata on specific concepts (`concept.register`, `concept.variety`).

## Concepts as universal feature expressions

A **concept** is an observable skill with a stable ID. It is expressed as:

1. **A `feature_expression`** in the universal backbone (UD + UniMorph + Concepticon + PHOIBLE).
2. **Per-language `surface_rules`** describing how the feature manifests in each language where it applies.
3. **Metadata** (CEFR level, dimension, L1 priors, reference URLs).

The key insight: a learner's competence in "past-tense perfective with be-auxiliary" aggregates across French, Italian, Dutch, and German — because they share the feature expression, differing only in surface rule. Cross-linguistic transfer is first-class.

### Concept ID scheme

```
<scope>:<dimension>:<feature_hash>
```

Where `scope` is either a 2-letter ISO language code (language-specific concept) or `u` (universal concept applicable to any language that exhibits the feature).

Examples:

```
# Universal concepts (apply to any language with these features)
u:morphology:verb.Tense=Past+VerbForm=Part+Aux=Be
u:morphology:noun.Gender+Definite
u:syntax:adjective.amod-placement
u:syntax:clause.acl:relcl
u:lexis:concepticon=1315                       # "to go", Concepticon GO
u:lexis:concepticon=1498+Person                # deixis (pronouns tied to person)

# Language-specific concepts (phonology/orthography/pragmatics/discourse)
fr:phonology:phoible=/y/                       # French front rounded vowel /y/
fr:phonology:phoible=/y/~/u/                   # /y/ vs /u/ contrast
fr:orthography:accent:e-vs-é-vs-è              # accent selection on /e/
fr:pragmatics:address:tu-vs-vous               # T/V distinction
fr:discourse:connector:donc                    # causal discourse connector
de:orthography:noun:capitalisation
hu:phonology:feature:vowel-harmony-front-back
ja:orthography:kana:kanji-mix                  # (when Japanese ships)
```

The feature expression after the dimension is a dotted/plus-joined token list using UD feature names and values, Concepticon IDs, or PHOIBLE segment IDs.

### Universal concepts

A universal concept is the *default* for morphology, syntax, and lexis. It declares:

```yaml
concept_id: u:morphology:verb.Tense=Past+VerbForm=Part+Aux=Be
dimension: morphology
name: "Past participle with be-auxiliary (perfect tense)"
feature_expression:
  ud_features: [VerbForm=Part, Tense=Past]
  ud_relations: [aux]
  aux_feature: [Voice=Act, lexical=be]
applies_to_languages:
  fr:
    cefr: A2
    surface_rule: "Movement and change-of-state verbs (DR & MRS VANDERTRAMP) take être"
    diagnostic: "aux lemma is `être` when head verb in {aller, venir, arriver, partir, ...}"
    reference_urls: [kwiziq, lawless, lingolia]
  it:
    cefr: A2
    surface_rule: "Movement/state verbs take essere; auxiliary choice determines participle agreement"
    reference_urls: [wiktionary, ...]
  de:
    cefr: A2
    surface_rule: "Bewegungsverben (kommen, gehen, fahren, ...) take sein; andernfalls haben"
    reference_urls: [...]
  nl:
    cefr: A2
    surface_rule: "Change-of-state and movement verbs take zijn; otherwise hebben"
applies_to_languages_except: []
l1_priors:
  en:
    note: "English has no auxiliary split (always 'have'). Learners frequently overgeneralise to avoir/haben/hebben."
  es:
    note: "Spanish has lost the split (haber only). Similar overgeneralisation to avoir/haben."
```

Note: `applies_to_languages` is an explicit whitelist. We don't assert a feature exists in a language until we've curated it. Silent inference is worse than admitting ignorance.

### Language-specific concepts

Used when no universal equivalent exists — phonology (each language's phoneme inventory is unique), orthography, pragmatics, discourse. Same schema minus `applies_to_languages`:

```yaml
concept_id: fr:phonology:phoible=/y/~/u/
dimension: phonology
name: "Rounded front /y/ vs rounded back /u/ contrast"
feature_expression:
  phoible_segments: ["y", "u"]
  contrast_type: "minimal-pair"
  panphon_distance: 1   # one articulatory feature apart (backness)
cefr: A1
diagnostic: "Mispronunciation or L1-biased substitution in recording, or rhyme/spelling confusion"
l1_priors:
  en: { note: "English lacks /y/; learners typically substitute /u/ or /ju/" }
  es: { note: "Spanish lacks /y/; typically substituted with /u/" }
reference_urls: [...]
```

## Schema

```sql
concepts
  concept_id           text primary key                      -- see scheme above
  scope                text not null                         -- 'u' or ISO 639-1
  dimension            text not null                         -- phonology | orthography | ...
  name                 text not null
  feature_expression   jsonb not null                        -- the universal feature bundle
  applies_to_languages jsonb not null default '{}'::jsonb    -- {lang: {cefr, surface_rule, ...}}
  l1_priors            jsonb not null default '{}'::jsonb    -- {l1: {note}}
  reference_urls       jsonb not null default '[]'::jsonb    -- see docs/REFERENCES.md
  prerequisites        jsonb not null default '[]'::jsonb    -- array of concept_id
  tags                 jsonb not null default '[]'::jsonb    -- register, variety, etc.
  created_at, updated_at

-- For fast lookup: "which concepts apply to language X?"
concept_language_applicability
  concept_id     text references concepts(concept_id)
  language       text
  cefr_level     text
  primary key (concept_id, language)

-- For fast lookup: "given a UD feature bundle, which concept does it map to?"
-- Populated by a materialised view from concepts.feature_expression.
concept_feature_index
  language       text
  dimension      text
  feature_key    text      -- e.g. "VerbForm=Part+Tense=Past+Aux=Be"
  concept_id     text
  primary key (language, dimension, feature_key)
```

## Per-user state: the dimension band vector

Instead of one CEFR band per language, we store a **vector** per `(user, language)`:

```json
{
  "user_id": "...",
  "language": "fr",
  "overall": { "band": "A2-B1", "confidence": 0.64 },
  "dimensions": {
    "phonology":    { "band": "A2",     "confidence": 0.41, "evidence_count": 34 },
    "orthography":  { "band": "A2-B1",  "confidence": 0.72, "evidence_count": 187 },
    "morphology":   { "band": "A2",     "confidence": 0.70, "evidence_count": 156 },
    "syntax":       { "band": "A2",     "confidence": 0.68, "evidence_count": 134 },
    "lexis":        { "band": "B1",     "confidence": 0.81, "evidence_count": 412 },
    "pragmatics":   { "band": "A1-A2",  "confidence": 0.30, "evidence_count": 22 },
    "discourse":    { "band": "A2",     "confidence": 0.55, "evidence_count": 68 }
  }
}
```

Per-concept state lives in a separate table, keyed by `(user_id, language, concept_id)`:

```sql
learner_concept_state
  user_id
  language
  concept_id
  status              text            -- 'unseen' | 'exposed' | 'practiced' | 'mastered' | 'struggling'
  encounters          int             -- times the concept appeared in input
  productions         int             -- times the user produced it
  correct_productions int             -- times correct
  recalls             int             -- SRS review count
  correct_recalls     int
  ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at   -- SM-2 fields
  last_updated_at
  primary key (user_id, language, concept_id)
```

## Measuring per-dimension state

Each dimension has specific deterministic signals extractable from every message. `docs/PARSING.md` covers the extraction pipeline; below is what each dimension measures:

### Phonology
- **Parser signals**: n/a (text-only in v1; audio in Phase 2).
- **Spelling-based proxies**: homophone confusions, diacritic omissions that imply phonological misperception.
- **Audio signals (Phase 2)**: pronunciation-coach subagent emits per-phoneme mismatches → lookup in PHOIBLE inventory → update corresponding `u:phonology:phoible=X~Y` concept.
- **Per-concept state**: per-phoneme-pair confusion scores.
- **Band estimator**: weighted by concept CEFR levels.

### Orthography
- **Parser signals**: nspell errors, deterministic diacritic checks, per-language punctuation rules.
- **Per-concept state**: per spelling/accent rule accuracy.
- **Band estimator**: errors per 100 chars, weighted by word CEFR level.

### Morphology
- **Parser signals**: UD morphological feature mismatches detected by the parser or by rule-based checks against UniMorph paradigms.
  - Example: parser assigns `VerbForm=Part|Tense=Past|Gender=Masc` to a token whose head auxiliary lemma is `avoir` rather than `être` on a movement verb → detected deterministically, mapped to `u:morphology:verb.Tense=Past+VerbForm=Part+Aux=Be` violation in French.
- **Per-concept state**: per-concept scoreboard (attempts, correct). For each UD paradigm slot the user produces, a signal.
- **Band estimator**: coverage × accuracy over the CEFR-graded concept inventory.

### Syntax
- **Parser signals**: UD dependency relations present/absent/misused.
  - Example: `amod` dep with a French adjective lemma known to require pre-nominal position but attached post-nominally → violation of `fr:syntax:adjective.amod-placement`.
  - Aggregate: subordination ratio (count of `acl:*`, `advcl`, `ccomp`, `xcomp`, `csubj` relations per T-unit).
- **Per-concept state**: per-concept scoreboard.
- **Band estimator**: subordination ratio + concept coverage drive much of overall CEFR banding.

### Lexis
- **Parser signals**: lemmatised tokens mapped to Concepticon concept sets. Unknown lemmas are new vocabulary.
- **Per-concept state**: per-lemma SRS state (the existing `vocabulary` table).
- **Per-Concepticon-set state**: aggregated across equivalent lemmas in any language the user is learning. `u:lexis:concepticon=1315` (GO) accumulates across `aller`, `ir`, `gehen`, `menni`.
- **Band estimator**: known-lemma-set size against frequency-banded CEFR thresholds (A1≈500, A2≈1000, B1≈2000, B2≈4000, C1≈8000, C2≈16k+), adjusted by rarity distribution.

### Pragmatics
- **Parser signals**: weak/non-existent. Heuristics on specific markers (French `tu`/`vous`, Japanese formality, Korean speech levels).
- **LLM signals (Opus post-send analysis)**: register and politeness judgement on a rubric, when the deterministic signal is absent.
- **Per-concept state**: per-speech-act scoreboard.
- **Band estimator**: low confidence by default.

### Discourse
- **Parser signals**: UD `discourse`, `parataxis` relations (sparse); counts of connective lemmas against a curated per-language connective list.
- **Per-concept state**: per-connective frequency and contextual correctness.
- **Band estimator**: presence/absence of CEFR-graded connectives + multi-sentence coherence score.

## How concepts get into the catalog

1. **Universal concepts** are seeded from the UD feature inventory, UniMorph paradigm specifications, and Concepticon concept sets. A build script `bun scripts/seed-universal-concepts.ts` ingests these standards and generates the `u:*` concept rows. Roughly 300–500 universal concepts at v1.
2. **Language applicability** is hand-curated per language in `assets/concepts/<lang>.yaml`. Each language says which universal concepts apply and at what CEFR level, plus surface rules and L1 priors. Target: ~200 applied concepts per supported language.
3. **Language-specific concepts** (phonology, orthography, pragmatics, discourse) are hand-curated per language. Phonology concepts are generated from PHOIBLE plus minimal-pair pairs at Panphon distance=1–2. Other dimensions are fully manual.
4. **Runtime unmatched features** — when the parser detects a feature bundle that doesn't resolve to any concept in `concept_feature_index`, a row is written to `unmatched_features` with the full feature bundle, token, and message ID. Human curators review weekly.

Never invent concepts at runtime. Silent invention corrupts the catalog faster than sparse coverage would hurt us.

## Why universal beats per-language

Without the backbone, competitive apps end up with incompatible per-language taxonomies. A learner who is B1 in French morphology learning Italian starts from cold in Italian morphology — even though 80% of the features overlap. With the backbone:

- **Transfer is first-class.** Starting Italian with French B1 morphology preloads ~70% of `u:morphology:*` concepts to `exposed` status. The system knows to skip re-teaching passé composé-with-be as a new concept.
- **L1 interference modelling is measurable.** If a native English speaker learning French systematically errs on `u:morphology:noun.Gender`, we can predict the same struggle for Italian and Spanish before they encounter it.
- **Aggregation is honest.** "This learner has mastered 47% of B1-and-below morphology concepts" is a claim we can back. Point estimates per language are cheap; the aggregate is expensive and novel.
- **The catalog scales.** Adding a new language requires ~200 applicability rows plus phonology/orthography curation, not 1,000 new per-language concepts. The universal features are already in the catalog.

## Edge cases

- **Same feature, different form.** `fr:syntax:adjective.amod-placement` handles French adjective pre/post-nominal placement. Spanish has similar but different rules (`buen hombre` vs `hombre bueno`); Spanish applicability stores its own surface rule on the same concept. Users who learn French then Spanish see transfer benefit, plus an L1→L2-specific prior about the differences.
- **Languages without the feature.** `u:morphology:verb.Tense=Past+VerbForm=Part+Aux=Be` doesn't apply to Spanish (haber-only). Spanish applicability is absent; the concept is invisible for Spanish learners.
- **Feature exists but is grammaticalised differently.** Romance grammatical gender vs German three-way gender vs Hungarian none. Universal concept `u:morphology:noun.Gender` applies to FR/IT/ES/DE with per-language surface rules; unavailable for HU.
- **Cross-dimensional errors.** `j'ai allé` is both morphology (auxiliary) and syntax (agreement). We tag a primary and list secondaries; both dimensions update.
- **Fossilised errors.** A user who keeps erring on the same concept despite repeated correction gets `status=struggling`; Phase 3's targeted-practice session spawns a focused role-play on that concept.

## What this design doesn't give us

- **Valid CEFR assessment.** Neither does any software. Our band vector is a strong proxy for targeting instruction and displaying progress — not for certifying level.
- **Perfect coverage of long-tail languages.** UD covers ~150 languages with wildly varying treebank sizes. Minority languages have thin UD support and may need custom parsers.
- **Reliable pragmatic/discourse scoring.** Universal standards are weak here. Claude-based LLM scoring fills the gap but with lower confidence.
- **Zero-curation onboarding for a new language.** Adding a language is still 2–4 weeks of curation work per language. The universal backbone reduces this from "build a concept catalog" to "annotate applicability."

## References and standards

Universal backbone:

- Universal Dependencies v2 — https://universaldependencies.org — syntactic/morphological feature inventory, 150 languages, CC-BY-SA (tagset use is unrestricted).
- UniMorph — https://unimorph.github.io — 170-language morphological paradigms, CC-BY 4.0, UD-aligned since v4.0.
- Concepticon — https://concepticon.clld.org — ~4,400 cross-linguistic concept sets, CC-BY 4.0.
- PHOIBLE — https://phoible.org — 3,000+ phoneme inventories across 2,000+ languages, CC-BY-SA 3.0.
- PanPhon — https://github.com/dmort27/panphon — articulatory feature vectors for IPA segments, MIT.

Parsers (see `docs/PARSING.md`):

- Stanza — https://stanfordnlp.github.io/stanza/ — UD-native, 70+ languages, Apache 2.0.
- Trankit — https://github.com/nlp-uoregon/trankit — 100+ languages, more accurate, Apache 2.0.

Pedagogical frame:

- Bachman, L. F., & Palmer, A. S. (1996). *Language Testing in Practice*.
- Council of Europe (2001). *Common European Framework of Reference for Languages*.
- English Profile (englishprofile.org), Profile Deutsch, Un Référentiel FR — CEFR-aligned per-language evidence used to calibrate universal concepts' CEFR levels.

Explicitly rejected (with reasons):

- WALS / Grambank — typological, too coarse for learner-scale concept tracking.
- GOLD — dead since ~2010.
- ISOcat — retired in 2015.
- Leipzig Glossing Rules — notation convention, not a controlled vocabulary.
- OLiA — alive but heavier than needed; map to it later if interop is required.

All standards used are CC-compatible for commercial self-hosted and SaaS distribution; attribution lives on the app's about page.
