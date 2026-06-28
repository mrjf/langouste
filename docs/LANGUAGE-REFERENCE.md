# Language Reference Graph

Langouste has two complementary views over the same universal language ontology:

1. **Learner profile** — what a user has seen, produced, missed, reviewed, and mastered.
2. **Language reference** — how a language itself works across the same dimensions.

The learner profile answers: "What does this learner know about Hungarian definite conjugation?"

The language reference answers: "How does Hungarian definite conjugation work, where does it sit in the universal feature system, how is it expressed, what examples show it, and which high-quality sources explain it?"

These must use the same concept IDs. The concept graph is not just a progress tracker. It is also the map of the language.

## Product shape

Every supported language gets a stable entry point:

```text
/languages/:language
/languages/:language/phonology
/languages/:language/orthography
/languages/:language/morphology
/languages/:language/syntax
/languages/:language/lexis
/languages/:language/pragmatics
/languages/:language/discourse
/languages/:language/:dimension/:concept_id
```

This mirrors the learner profile routes:

```text
/profile/:language
/profile/:language/:dimension
/profile/:language/:dimension/:item_type/:item_id
```

The difference is state:

| View | Subject | Same ontology? | Shows progress? | Shows language facts? |
|---|---|---:|---:|---:|
| Learner profile | One user in one language | Yes | Yes | Only enough to explain the user's evidence |
| Language reference | One language | Yes | No | Yes, dense and authoritative |

## Language home page

`/languages/fr` is a compact reference grammar and lexical overview for French. It should not be a marketing page or a generic Wikipedia clone. It should be an expert map of the language through our seven dimensions:

1. **Phonology** — phoneme inventory, stress, liaison/enchaînement, prosody, major L1 traps.
2. **Orthography** — writing system, spelling-to-sound rules, diacritics, punctuation conventions.
3. **Morphology** — nominal categories, verbal paradigms, agreement, derivation.
4. **Syntax** — dependency structure, word order, clause types, subordination, negation.
5. **Lexis** — core vocabulary layers, productive derivational patterns, register, borrowings, collocations.
6. **Pragmatics** — address systems, politeness, speech acts, register choices.
7. **Discourse** — connectors, information structure, topic continuity, genre conventions.

Each section links into concept pages. Each concept page links outward to high-quality resources.

## Concept pages describe features, not lessons

A language concept page is a reference node:

```yaml
language: fr
concept_id: u:morphology:verb.Tense=Pqp+Mood=Sub
name: "Plus-que-parfait du subjonctif"
dimension: morphology
universal_function:
  tense_aspect: anterior-to-past reference
  mood_modality: subjunctive / irrealis / non-asserted dependent clause
  discourse_function: formal/literary counterfactuality, anteriority under subjunctive trigger
language_realization:
  has_dedicated_form: true
  form_pattern: "auxiliary être/avoir in imperfect subjunctive + past participle"
  register: "literary, archaic, highly formal"
  modern_spoken_strategy: "plus-que-parfait de l'indicatif or passé du subjonctif depending context"
examples:
  - target: "Il fallait qu'il eût terminé avant midi."
    base: "He had to have finished before noon."
    notes: ["literary", "rare in speech"]
references:
  pedagogical: [...]
  grammars: [...]
  papers: [...]
  corpora: [...]
```

The page should explain:

- what the feature means;
- whether the language has a dedicated grammatical form for it;
- how it is built;
- when native speakers actually use it;
- what learners usually confuse it with;
- how the same universal function is expressed in related or user-known languages;
- where to read more, with strong source quality labels.

## Universal function vs language realization

The ontology must not assume every language has the same grammatical categories. The universal layer describes **functions and feature bundles**. Each language describes how that function is realized.

Example: "anterior counterfactual or dependent-clause past-before-past irrealis" can be realized differently:

| Language | Dedicated form? | Typical realization |
|---|---:|---|
| French | Yes, historically/literarily | `eusse/fusse` + past participle; rare in modern speech |
| English | No distinct subjunctive pluperfect paradigm | `had` + past participle in counterfactual clauses |
| Hungarian | No direct equivalent tense paradigm | conditional/periphrastic strategy, often with temporal/contextual marking |
| Danish | No direct equivalent tense paradigm | periphrastic perfect/pluperfect plus modal or subordinate-clause context |
| Polish | No direct equivalent tense paradigm | aspect, conditional particles, and clause context |
| Hebrew | No direct equivalent tense paradigm | periphrastic/modal/contextual strategy |

This means every language page can answer the same question:

> "How would this language express the meaning covered by `u:morphology:verb.Tense=Pqp+Mood=Sub`?"

The answer may be "with a dedicated inflection", "with a periphrastic construction", "with aspect plus particles", "with context", or "this distinction is normally not grammatically encoded."

That is the point. The ontology gives us a universal comparison target; the language reference tells the truth about the specific language.

## Same concept graph, two projections

The same concept row supports both product surfaces.

```yaml
concept_id: u:morphology:verb.Tense=Pqp+Mood=Sub
dimension: morphology
universal_name: "Pluperfect subjunctive / anterior irrealis in dependent clauses"
feature_expression:
  ud_features: [Tense=Pqp, Mood=Sub]
  unimorph_features: [PQP, SBJV]
semantic_function:
  anteriority: past_before_past
  modality: irrealis_or_nonasserted
  clause_scope: dependent_clause
language_realizations:
  fr:
    name: "Plus-que-parfait du subjonctif"
    has_dedicated_form: true
    cefr: C1
    register: literary
    surface_rule: "imperfect subjunctive auxiliary + past participle"
  en:
    name: "Counterfactual pluperfect"
    has_dedicated_form: false
    surface_rule: "had + past participle in counterfactual/subordinate contexts"
  hu:
    name: "Anterior counterfactual strategy"
    has_dedicated_form: false
    surface_rule: "conditional/periphrastic construction; details curated per language"
```

For a learner, the profile state attaches to `(user_id, language, concept_id)`.

For a language, the reference state attaches to `(language, concept_id)`.

```sql
language_concept_reference
  language              text
  concept_id            text
  local_name            text
  description           text
  realization_type      text    -- inflection | periphrasis | particle | word_order | context | absent
  register              text
  cefr_level            text
  surface_rules         jsonb
  examples              jsonb
  bibliography          jsonb
  source_quality        jsonb
  updated_at
  primary key (language, concept_id)
```

## Source model

Reference pages should link densely, but not indiscriminately. Every link needs a source type and quality label.

### Source tiers

| Tier | Type | Examples | Use |
|---|---|---|---|
| A | Standards / structured databases | Universal Dependencies, UniMorph, Concepticon, PHOIBLE, WALS, Glottolog, Grambank | Feature inventory, typology, language metadata |
| A | Scholarly grammars and papers | peer-reviewed articles, descriptive grammars, university-hosted PDFs, handbook chapters | Deep explanation and evidence |
| B | High-quality pedagogical grammars | Lawless French, Kwiziq, Lingolia, HungarianReference, national education resources | Learner-facing explanations |
| B | Lexical/reference sites | Wiktionary, WordReference, Reverso Context, Tatoeba | Word-level reference and examples |
| C | Community material | forums, blogs, Reddit, StackExchange | Only as secondary color; never source of truth |

### Bibliography entry

```yaml
- source_id: "fr-pqp-subj-grevisse"
  title: "Le Bon Usage"
  authors: ["Grevisse", "Goosse"]
  source_type: scholarly_grammar
  quality: A
  url: null
  notes: "Canonical reference grammar; cite edition/page in curated notes."

- source_id: "unimorph-schema"
  title: "UniMorph Schema"
  source_type: standard
  quality: A
  url: "https://unimorph.github.io/schema/"
  concepts: ["u:morphology:verb.Tense=Pqp+Mood=Sub"]
```

We link to sources. We do not embed long copyrighted text. Stored summaries must be original, short, and attributable.

## High-quality external resource families

The language-reference system should support links to:

- **Universal Dependencies** — syntax relations, POS tags, morphological features, treebanks: `https://universaldependencies.org/`
- **UniMorph** — cross-lingual morphological feature schema and paradigms: `https://unimorph.github.io/`
- **Concepticon** — cross-lingual lexical concept sets: `https://concepticon.clld.org/`
- **PHOIBLE** — phonological inventories: `https://phoible.org/`
- **WALS** — typological feature chapters and maps: `https://wals.info/`
- **Glottolog** — language classification and bibliographic metadata: `https://glottolog.org/`
- **Grambank** — typological grammar features: `https://grambank.clld.org/`
- **World Lexicon of Grammaticalization** — grammaticalization pathways, where licensed/linkable.
- **Language-specific descriptive grammars** — university presses, open grammars, national academies, scholarly PDFs.
- **Peer-reviewed papers** — for language-specific phenomena, especially where pedagogical sites are shallow.
- **Corpora and treebanks** — UD treebanks, OPUS, Tatoeba, national corpora where linkable.

This should eventually become a curated bibliography table, not hardcoded UI links.

## Curator workflow

1. Add or update a universal concept in the ontology.
2. For each supported language, add a `language_concept_reference` realization row:
   - present, absent, or not-yet-curated;
   - realization type;
   - short original explanation;
   - examples with base-language translations;
   - source links.
3. Attach parser evidence:
   - UD features/relations that detect the concept;
   - language-specific rule checks;
   - known false positives.
4. Attach learner-facing guidance:
   - common L1 confusions;
   - CEFR estimate;
   - whether it is productive, literary, archaic, formal, colloquial, regional.
5. Run validation:
   - no orphan concept IDs;
   - every source has `source_type` and `quality`;
   - every example has target text, base translation, and attribution if needed.

## Runtime use

The language reference should power:

- "Learn more" links from corrections and profile pages.
- Concept pages under `/languages/:language/...`.
- Hover explanations for grammar concepts, not just words.
- Cross-language comparison: "French marks this with X; Hungarian normally uses Y."
- Curriculum generation: choose the next concept from the same universal graph the learner state uses.
- Parser debugging: when a parsed feature maps to a concept, the concept page explains the linguistic rationale.

## Dense links everywhere

Any reference section, profile section, word page, sentence page, correction, or quiz result should be able to emit dense external links. The user should never hit a dead-end explanation.

Examples:

- `/languages/hu/morphology/verb.definite-conjugation`
  - scholarly papers on Hungarian object agreement;
  - HungarianReference explanations;
  - relevant UD / UniMorph feature docs;
  - YouTube lessons tagged to the same concept;
  - corpus examples;
  - Wiktionary paradigms for representative verbs;
  - exercises on producing definite vs indefinite conjugation.
- `/profile/hu/morphology/...`
  - the user's evidence and FSRS state;
  - the language-reference explanation for the same concept;
  - links to external resources;
  - "practice this now" actions.
- A sentence in a chat
  - concept chips for lexical items, morphology, syntax, negation, discourse markers;
  - links from each chip to the language reference and profile state;
  - actions to drill the concept or generate more examples like it.

The link system should not be limited to traditional dictionary and grammar pages. It should support:

| Resource type | Examples | Use |
|---|---|---|
| Dictionary | Wiktionary, WordReference | definitions, POS, examples, inflection tables |
| Bilingual examples | Linguee, Reverso Context, Tatoeba | contextual usage and translation contrast |
| Video | YouTube lessons, lectures, native usage clips | explanation, pronunciation, listening examples |
| Scholarly papers | journal articles, university PDFs, handbook chapters | authoritative analysis and edge cases |
| Typology databases | WALS, Grambank, Glottolog, PHOIBLE | cross-linguistic comparison |
| Standards | UD, UniMorph, Concepticon | stable feature IDs and parser mapping |
| Corpora | UD treebanks, OPUS, national corpora where linkable | real usage evidence |
| Exercises | internal generated drills, external worksheets where linkable | immediate practice |

### Resource links table

Links should be first-class data, not embedded prose.

```sql
concept_resources
  resource_id       text primary key
  language          text null                 -- null means universal
  concept_id        text null                 -- null allowed for whole-language resources
  dimension         text null
  resource_type     text                      -- dictionary | video | paper | corpus | typology | exercise | grammar
  source_name       text                      -- YouTube, WordReference, Linguee, WALS, etc.
  title             text
  url               text
  quality           text                      -- A | B | C
  license_note      text
  tags              jsonb                     -- ["beginner", "formal-register", "negation"]
  applies_to        jsonb                     -- lemmas, POS, UD features, CEFR bands, etc.
  created_at, updated_at
```

Resource links can attach to:

- a whole language: `language=hu`;
- a dimension: `language=hu, dimension=morphology`;
- a concept: `language=hu, concept_id=u:morphology:verb.Definite=Def`;
- a lexical item: `language=hu, lemma=megtalál` via a lexical-resource join;
- a sentence annotation: via `concept_id` + span evidence.

### Ranking links

The UI should rank links by context:

1. exact concept match;
2. exact lemma + POS match;
3. language + dimension match;
4. user's base language availability;
5. source quality;
6. CEFR level fit;
7. media preference, if known.

For a beginner, a high-quality YouTube or pedagogical page may rank above a paper. For an advanced user or a curator, the paper should rank first. The links are the same; the ranking changes.

## Pivoting into exercises

Every concept chip should support a "practice" action. The action creates a quiz/exercise from the same concept graph and writes the result back to learner state.

Exercise entry points:

- from a language reference concept page: "Practice this concept";
- from a profile weak spot: "Review due now";
- from a correction: "Drill this error";
- from a sentence chip: "Make me produce this structure";
- from a word hover: "Practice this lemma / form / collocation";
- from a cross-language comparison: "Practice the difference between how French and Hungarian express this."

Exercise types:

| Exercise | Good for | Required concept data |
|---|---|---|
| Recognition | seen/understood concepts | examples, distractors, translations |
| Production | active recall | prompts, target forms, accepted variants |
| Transformation | morphology/syntax | source sentence, target feature change |
| Cloze | lexis, agreement, particles | token spans, lemma/POS/features |
| Minimal pairs | phonology/orthography | contrast sets |
| Free production | pragmatic/discourse concepts | rubric, target speech act, parser checks |

The important rule: exercises are generated from concepts, not from ad hoc prompt text. A completed exercise emits the same interaction events as chat:

```yaml
event_type: quiz
source: exercise
language: fr
concept_id: u:morphology:verb.Tense=Pqp+Mood=Sub
outcome: incorrect
evidence:
  prompt: "Rewrite in the required anterior subjunctive form."
  expected_features: [Tense=Pqp, Mood=Sub]
  user_answer: "il ait terminé"
  expected_answer: "il eût terminé"
  spans: [...]
```

That updates FSRS, profile counts, and the concept's evidence history.

## Sentence and word typology graph

Every sentence we display or store should be parseable into annotated spans. A sentence is not just text; it is a set of typological and lexical claims.

Example sentence annotation:

```yaml
sentence_id: msg_123:sentence_1
language: hu
text: "Nem találom a projektet."
tokens:
  - index: 0
    text: "Nem"
    lemma: "nem"
    upos: PART
    features: [Polarity=Neg]
    concepts:
      - u:syntax:negation.placement
      - hu:lexis:nem
  - index: 1
    text: "találom"
    lemma: "talál"
    upos: VERB
    features: [Mood=Ind, Tense=Pres, Number=Sing, Person=1, Definite=Def]
    concepts:
      - u:morphology:verb.Tense=Pres
      - hu:morphology:verb.definite-conjugation
      - hu:lexis:talál
  - index: 2
    text: "a"
    lemma: "a"
    upos: DET
    features: [Definite=Def]
    concepts:
      - u:syntax:determiner.definiteness
      - hu:lexis:a
  - index: 3
    text: "projektet"
    lemma: "projekt"
    upos: NOUN
    features: [Case=Acc, Number=Sing]
    concepts:
      - u:morphology:noun.Case=Acc
      - hu:lexis:projekt
spans:
  - span_type: VP
    token_range: [1, 1]
    concepts:
      - u:morphology:verb.Tense=Pres
      - hu:morphology:verb.definite-conjugation
  - span_type: negation
    token_range: [0, 1]
    concepts:
      - u:syntax:negation.placement
  - span_type: object_np
    token_range: [2, 3]
    concepts:
      - u:morphology:noun.Case=Acc
      - u:syntax:determiner.definiteness
```

This creates pivots:

- click `találom` → lexical page for `talál`, form explanation, conjugation table, profile state, exercises;
- click `Tense=Pres` chip → present-tense reference, user's mastery of present tense, exercises;
- click `Definite=Def` on the VP → Hungarian definite conjugation reference, user evidence, drills;
- click negation span → Hungarian negation placement reference, examples, exercises;
- click sentence typology → cross-language comparison of how English/French/Hungarian encode the same meaning.

### Span tags

Sentence annotations should include both token-level and span-level tags:

| Tag type | Example | Span |
|---|---|---|
| Lexical item | `hu:lexis:talál` | token |
| Inflected form | `hu:form:találom` | token |
| POS | `upos=VERB` | token |
| Morphology | `u:morphology:verb.Tense=Pres` | token or VP |
| Syntax | `u:syntax:negation.placement` | negation construction |
| Clause | `u:syntax:clause.relative` | clause span |
| Discourse | `hu:discourse:connector:tehát` | token or discourse segment |
| Pragmatics | `fr:pragmatics:address:tu-vs-vous` | utterance span |
| Phonology | `hu:phonology:vowel-harmony` | word or phrase |

These tags should be generated by deterministic parsing/rules where possible, then curated or reviewed when coverage is missing. LLMs may explain tags, but they should not invent canonical tag IDs.

### Sentence annotation storage

```sql
sentence_annotations
  annotation_id      text primary key
  message_id         text null
  source_type        text        -- chat | example | exercise | corpus | reference
  language           text
  sentence_text      text
  parser             text
  parser_version     text
  tokens             jsonb
  spans              jsonb
  concepts           jsonb       -- unique concept IDs present in sentence
  created_at

concept_evidence_spans
  evidence_id        text primary key
  concept_id         text
  language           text
  source_type        text
  source_id          text        -- message_id, exercise_id, corpus sentence id, etc.
  token_start        int
  token_end          int
  span_type          text
  evidence_role      text        -- seen | produced | corrected | quiz_expected | quiz_answer
  outcome            text null   -- correct | incorrect | assisted | unknown
```

This is the bridge between text, profile state, exercises, and language reference. It lets any word or sentence pivot into:

- the learner's profile for the concept;
- the language reference for the concept;
- external resources;
- generated exercises;
- typological comparison.

## Corpus linguistics links

Every language reference page, concept page, word page, and sentence annotation should be able to push the user into corpus searches. Corpus links answer a different question from dictionaries or grammar references:

> "Show me real attestations of this form, lemma, construction, register, or discourse pattern."

Corpus search links should be generated from the same annotations:

- lemma: `projekt`;
- surface form: `projektet`;
- POS: `NOUN`;
- morphology: `Case=Acc`;
- syntax: object NP, negation span, relative clause span;
- concept ID: `u:morphology:noun.Case=Acc`;
- phrase/sentence: `"Nem találom a projektet."`;
- language, register, CEFR, source type, if known.

### Public corpus providers

Public providers should be configured as templates. We link out; we do not scrape unless the provider has an explicit API/license for it.

```yaml
corpus_providers:
  - provider_id: sketchengine_open
    name: "Sketch Engine Open Corpora"
    provider_type: public
    languages: ["en", "fr", "de", "es", "it", "pt", "pl", "hu", "da", "he"]
    search_modes: ["lemma", "surface", "phrase"]
    url_templates:
      surface: "https://app.sketchengine.eu/#concordance?corpname={corpus}&q=q{surface}"
      lemma: "https://app.sketchengine.eu/#concordance?corpname={corpus}&q=l{lemma}"
    quality: A
    notes: "Use only open corpora or user-authenticated corpora; no scraping."

  - provider_id: opus
    name: "OPUS"
    provider_type: public
    languages: ["many"]
    search_modes: ["parallel_sentence", "phrase"]
    url_templates:
      search: "https://opus.nlpl.eu/"
    quality: A
    notes: "Parallel corpus hub; good for translation equivalents and aligned examples."

  - provider_id: tatoeba
    name: "Tatoeba"
    provider_type: public
    languages: ["many"]
    search_modes: ["surface", "phrase", "translation"]
    url_templates:
      search: "https://tatoeba.org/en/sentences/search?from={lang3}&to={base_lang3}&query={query}"
    quality: B
    notes: "CC-BY examples; useful for learner-friendly sentence pivots."
```

Provider coverage is not uniform. Each language should have its own curated provider list:

```yaml
language_corpus_map:
  hu:
    default:
      - provider_id: sketchengine_open
      - provider_id: opus
      - provider_id: tatoeba
    curated:
      - provider_id: hungarian_national_corpus
        name: "Hungarian National Corpus"
        provider_type: public_or_institutional
        url_templates:
          search: "..."
        notes: "Use deep links where available; authentication may be required."
  fr:
    default:
      - provider_id: sketchengine_open
      - provider_id: opus
      - provider_id: tatoeba
    curated:
      - provider_id: frantext
        name: "Frantext"
        provider_type: institutional
        notes: "Deep-link/search if user has access."
  da:
    default:
      - provider_id: sketchengine_open
      - provider_id: opus
      - provider_id: tatoeba
```

The product should degrade gracefully:

1. exact language-specific corpus provider;
2. multilingual public provider;
3. sentence/example provider;
4. generic web search scoped to trusted domains, only if explicitly configured.

### Corpus query objects

Instead of hardcoding URL strings in components, UI actions should emit a corpus query object:

```yaml
query_type: concordance
language: hu
base_language: en
surface: "projektet"
lemma: "projekt"
upos: NOUN
features:
  Case: Acc
  Number: Sing
concept_ids:
  - u:morphology:noun.Case=Acc
  - hu:lexis:projekt
context:
  sentence: "Nem találom a projektet."
  token_range: [3, 3]
```

The provider registry turns that into provider-specific URLs. If a provider supports lemma search, use lemma. If it only supports text search, use surface/phrase. If it supports CQL, emit a CQL query.

Example generated CQL:

```text
[lemma="projekt" & tag="NOUN" & Case="Acc"]
```

Provider adapters decide whether CQL, query strings, or plain phrase search is supported.

### Private corpus providers

Users and institutions may have access to private corpora: university databases, paid Sketch Engine corpora, national corpora, internal company text, personal reading archives, or research datasets. Langouste should let them configure those without hardcoding credentials into the app.

```sql
user_corpus_providers
  provider_id        text primary key
  user_id            text
  name               text
  language           text null
  provider_type      text      -- private_url_template | api | sql | elastic | local_file_index
  auth_type          text      -- none | api_key | bearer | basic | cookie_manual | oauth
  config             jsonb     -- encrypted at rest where credentials exist
  url_templates      jsonb
  capabilities       jsonb     -- lemma, surface, phrase, cql, aligned_translation
  enabled            boolean
  created_at, updated_at
```

Private providers are searched only when:

- the user explicitly enables them;
- the provider language matches the query, or the provider declares multilingual support;
- the provider capability can satisfy the query;
- credentials are present and valid.

Examples:

```yaml
- name: "My university Sketch Engine"
  provider_type: private_url_template
  language: hu
  auth_type: cookie_manual
  capabilities: [lemma, surface, phrase, cql]
  url_templates:
    cql: "https://app.sketchengine.eu/#concordance?corpname={corpus}&q={encoded_cql}"

- name: "Company translation memory"
  provider_type: api
  language: fr
  auth_type: bearer
  capabilities: [phrase, aligned_translation]
  config:
    endpoint: "https://example.internal/search"
```

### Privacy and security

Private corpus access has stricter rules than public reference links:

- never send private corpus credentials to the browser unless the provider requires direct browser navigation;
- proxy API searches server-side when possible;
- encrypt stored credentials;
- show the provider name before opening a private link;
- allow per-provider disable/delete;
- never mix private-corpus examples into public shared datasets;
- never use private corpus contents for global model training or shared recommendations;
- log only metadata needed for debugging, not full private search results.

### UI pivots

Corpus pivots should appear wherever the user can inspect language:

- word hover: "Search corpus for this form", "Search corpus for lemma";
- sentence chip: "Find similar negation examples";
- concept page: "Show corpus examples of this construction";
- profile weak spot: "Show real examples before drilling";
- exercise result: "Show authentic examples of the correct form";
- language reference page: "Explore this feature in corpora."

For example, clicking the accusative tag on `projektet` can offer:

1. `projektet` exact surface concordance;
2. `projekt` lemma concordance;
3. Hungarian nouns with `Case=Acc`;
4. object NP examples with definite article + accusative noun;
5. parallel examples where English has a direct object.

## Non-goals

- Do not create AI-invented grammar categories at runtime.
- Do not claim a language has a category just because another language has it.
- Do not pretend a universal function always has a one-to-one grammatical equivalent.
- Do not store copyrighted grammar text. Link to it and write original summaries.
- Do not let learner-state labels diverge from language-reference labels.

## Principle

The ontology describes **language features**.

The learner profile describes **a user's relationship to those features**.

The language reference describes **a language's realization of those features**.

Those are separate projections over the same graph. If they ever fork, the product becomes incoherent.
