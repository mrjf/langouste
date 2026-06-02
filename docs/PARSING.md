# Deterministic parsing and feature extraction

Every message the user sends is parsed into a universal feature representation before any LLM runs. The output feeds the ontology in `docs/ONTOLOGY.md` — competence updates, error detection, and concept mapping are all grounded in this deterministic pass first. Only when the parser can't explain something does an LLM fill the gap.

This is load-bearing. It's what lets Langouste be honest about competence (you can audit the feature extractions), cheap (no LLM call on every message), fast (parse latency in tens of milliseconds), and scalable (parse counts per month, not Claude turns).

## Why deterministic-first

LLMs are good at explaining language. They're surprisingly bad at *reliably structured* language analysis — hallucinated lemmas, inconsistent feature tags, and token-level imprecision. For "count the subordinate clauses," "which verb is the auxiliary," "what's the gender agreement" — a UD parser gets it right every time and fits in 100ms per sentence.

Deterministic also means:

- **Evidence is auditable.** A competence update can be traced to a specific feature extraction, not "Claude said so."
- **Costs are predictable.** Parsing is O(tokens) on local CPU. LLM calls vary 10–100× per turn.
- **Offline-friendly.** Full parse without any network call. Desktop-tier Langouste (Phase 4) still works without an internet connection for the learner-state updates.
- **Testable at the unit level.** Given input text → expected feature bundle. No model drift.

## The parsing stack

Target: UD v2-compliant parser per language, producing the `CoNLL-U` feature set (UPOS, XPOS, FEATS, lemma, head, deprel).

Primary: **Stanza** (Stanford NLP). Apache 2.0. ~70 languages. UD-native output. Medium-sized neural models (~200MB per language). CPU-acceptable latency (50–200ms per sentence on typical hardware). Ships as a Python package; we run it as a sidecar service (see "Service shape" below).

Fallback / accuracy-critical: **Trankit**. Apache 2.0. 100+ languages. XLM-R-based, more accurate than Stanza especially on low-resource and morphologically rich languages. Heavier (~1GB model) and slower. Used for offline re-processing (eval harness) or when a user opts into the heavy tier.

Rejected:

- **spaCy** — UD-ish but inconsistent tagsets across languages. Avoid.
- **UDPipe 2** — fine but Stanza beats it on accuracy for most languages we care about.
- **CoreNLP** — English-centric and Java-based. Not worth the operational overhead.

Morphology-heavy languages layer a dedicated FST analyzer on top for paradigm coverage:

| Language | FST analyzer | License | Notes |
|---|---|---|---|
| Finnish | Omorfi | GPL | Use as a sidecar process; GPL applies to the analyzer binary, not to calling it over IPC |
| Hungarian | emMorph | Restricted | License review needed; may need replacement |
| Polish | Morfeusz2 | BSD-like | Drop-in |
| Japanese | SudachiPy | Apache 2.0 | Drop-in |
| Turkish | Zemberek / TRmorph | Apache 2.0 / GPL | Zemberek preferred |
| Arabic | Camel Tools | MIT | Drop-in |

FST output uses proprietary tagsets. We run them through UniMorph converters (in the UniMorph repo) to emit UD-compatible features.

## Service shape

Parsing runs as a separate Bun-managed Python sidecar, not in the main process:

```
src/services/parsing/
  index.ts                 -- TS interface + cache
  client.ts                -- zmq/HTTP/stdio client to sidecar
  stanza-sidecar.py        -- long-lived Python process with loaded models
  models/                  -- gitignored; populated by install script
```

Rationale:

- Stanza and Trankit are Python-only. A pure-TS reimplementation is not on the table.
- Models are heavy (200MB–1GB per language). Loading per request is catastrophic latency; loading per-process kept alive is fine.
- The sidecar spawns once per backend process, loads models lazily on first use per language, caches indefinitely.
- The TS client batches within a single message (all sentences), does not cache parse results (parses are fast; the cost isn't worth the invalidation complexity).

IPC: JSON over stdio for v1. Upgrade to shared-memory or zmq if latency becomes an issue. Not before.

Failure modes:

- **Sidecar crashes**: TS client auto-restarts with exponential backoff. During downtime, messages skip parsing and fall back to Opus-only explanation. Logged as a degraded-mode event.
- **Missing model**: first-time install detects missing models and runs `stanza.download('fr')` at boot. If download fails, the language is marked "parser unavailable" in the ontology until admin intervenes.
- **Parse timeout**: hard 5s per sentence. Timeouts fall back to degraded mode.

## Per-message extraction pipeline

What happens when a user presses Enter, in order, all within ~300ms target latency:

1. **Language detection** (existing `detector.ts`) — picks the target language for the parser.
2. **Tokenisation + sentence split** — Stanza does this; deterministic for almost every language.
3. **POS tag + morphological features + lemma** — Stanza produces per-token CoNLL-U. Example for French "j'ai allé":
   ```
   # text = j'ai allé
   1   j'    je    PRON  _  Number=Sing|Person=1|PronType=Prs  3  nsubj   _  _
   2   ai    avoir AUX   _  Mood=Ind|Number=Sing|Person=1|Tense=Pres|VerbForm=Fin  3  aux  _  _
   3   allé  aller VERB  _  Gender=Masc|Number=Sing|Tense=Past|VerbForm=Part  0  root  _  _
   ```
4. **Dependency parse** — Stanza emits head and deprel per token.
5. **Feature-to-concept mapping** — a deterministic mapper consults `concept_feature_index` (from the ontology schema). Each extracted feature bundle produces 0..N concept usages.
6. **Rule-based violation detection** — per-language rules fire against the parse. Each rule:
   - Has a deterministic condition (e.g., "VERB with `VerbForm=Part|Tense=Past` whose head `aux` lemma is `avoir` and whose lemma is in movement-verb list").
   - Maps to a specific concept_id.
   - Emits a `correction` with span, category, and concept_id.
7. **Lexis extraction** — each content-word lemma is looked up in the language's Concepticon mapping; unknown lemmas become candidate vocabulary; known lemmas update encounter counts.
8. **Aggregate features** — MLU, type-token ratio, subordination ratio, lexical rarity. Computed in one pass from the CoNLL-U output.
9. **Persist to learner-state update queue** — a compact diff of (concept_id, signal_type, outcome) tuples gets queued for async application to `learner_concept_state`.
10. **Hand off to downstream pipeline** — if step 6 found no violations and no spell errors, message sends directly. If it found something, Opus is called with the deterministic-detection pre-analysis as grounding.

This is radically cheaper than the current pipeline, which calls Opus on every message with errors. With the deterministic pass:

- Clean messages skip Opus entirely (already the case, but now with more errors caught before LLM).
- Messages with only deterministically-detected errors can short-circuit to a cached/templated explanation for the same concept_id, saving Opus calls.
- Opus only runs when genuinely novel explanation is required (new concept_id, unusual combination, user-confusion signal).

## Annotation output model

The parser should emit an annotation graph over the source text, not a single nested tree. Chat messages, transcript segments, lesson passages, and future classroom assignments all share the same primitive: immutable text plus labeled spans anchored by character offsets.

```typescript
interface TextAnnotation {
  annotation_id: string;
  source_type: "message" | "content_segment" | "reference_example" | "assignment";
  source_id: string;
  language: string;
  layer:
    | "word"
    | "phrase"
    | "sentence"
    | "translation"
    | "grammar"
    | "vocabulary"
    | "pronunciation"
    | "timestamp"
    | "assignment"
    | "other";
  start_offset: number; // inclusive Unicode code-point offset in normalized source text
  end_offset: number;   // exclusive Unicode code-point offset in normalized source text
  label: string;
  payload: Record<string, unknown>;
}
```

Offsets are the contract between parsing, translation, correction rendering, media transcript alignment, and learning-state updates. An offset range can have many labels at once: a word boundary, a phrase boundary, a translation span, a grammar concept, a pronunciation note, and a vocabulary encounter. These annotations may overlap, nest, or cross; code should not assume one clean hierarchy such as DOM nodes or a constituency parse.

Required layers for the first annotation-backed reader/player:

- **Word boundaries** from tokenizer output, with lemma, UPOS, morphology, and vocabulary concept IDs where known.
- **Phrase boundaries** from chunking, dependency subtrees, idiom/collocation detection, and translation alignment.
- **Sentence boundaries** from the parser, with aggregate features used by CEFR estimation.
- **Translation spans** for word-level glosses and phrase-level translations.
- **Grammar annotations** for concept usage, violations, and explanation anchors.
- **Vocabulary metadata** for known/unknown state, frequency band, encounters, and due-review status.
- **Pronunciation notes** for IPA, audio anchors, liaison/elision, stress, or phoneme contrasts.
- **Media anchors** for transcript timestamps and source-provider references.

This model directly supports the planned hover/tap translation UX: word-level help can bind to `layer="word"` spans, phrase-level help can bind to `layer="phrase"` or `layer="translation"` spans, and the UI can choose whether to show word help above, phrase help below, or both together.

## Rule-based violation detection

Per-language rules live in `assets/rules/<lang>.yaml`. Each rule is a minimal condition → concept_id mapping:

```yaml
# assets/rules/fr.yaml

- concept_id: u:morphology:verb.Tense=Past+VerbForm=Part+Aux=Be
  direction: violation
  name: "avoir used with movement verb in passé composé"
  condition:
    token:
      upos: VERB
      features: { VerbForm: Part, Tense: Past }
      lemma_in: [aller, venir, arriver, partir, entrer, sortir, monter,
                 descendre, rester, tomber, naître, mourir, retourner,
                 passer, devenir, apparaître]
    head:
      deprel: aux
      lemma: avoir
  severity: error
  explanation_key: "fr.passe_compose_etre.avoir_substitution"

- concept_id: fr:syntax:adjective.amod-placement
  direction: violation
  name: "post-nominal placement of pre-nominal adjective"
  condition:
    token:
      upos: ADJ
      lemma_in: [bon, mauvais, grand, petit, jeune, vieux, beau, joli, nouveau]
      deprel: amod
      position: after_head   # token index > head token index
  severity: warning
  explanation_key: "fr.adjective_placement.post_nominal_error"

- concept_id: u:syntax:agreement.subject-verb
  direction: violation
  name: "subject-verb person/number mismatch"
  condition:
    token:
      upos: VERB
      features: { VerbForm: Fin }
    nsubj_mismatch: true    # computed: nsubj's Person/Number doesn't match token's
  severity: error
  explanation_key: "u.agreement.subject_verb"
```

Rules are:

- **Declarative.** No code per rule. The engine matches JSON-ish conditions against the CoNLL-U output.
- **Concept-linked.** Every rule emits exactly one concept_id. Unlinked rules are a bug — the ontology must have a home for every observable.
- **Explanation-keyed.** Rules reference a key into a curated explanation catalog; Opus is only invoked when no cached explanation exists for the key+language+CEFR band.
- **Versioned.** Rules are in-repo, change-tracked. The eval harness regression-tests every rule against its fixture inputs.

### Generating rules

Rules are hand-authored per language by the linguistic curator. Realistic rule counts at v1:

- French: ~80 rules (biggest curated set initially)
- Spanish: ~60
- German: ~70
- Italian: ~50
- Portuguese: ~40
- Dutch: ~40
- Hungarian: ~50

That sounds like a lot, but the rules are small. Most are 5–10 lines of YAML. A curator with Claude's help can produce 10–20 per day.

### Universal rules

Rules tagged with scope `u:` apply across all languages where their condition holds. Example: subject-verb agreement violation is universal — any language where the parser assigns `VerbForm=Fin` and there's an `nsubj` relation with mismatching person/number triggers the rule. Languages without the feature (pro-drop with no overt subject) simply don't trigger.

## Mapping parser output to competence updates

Every parse produces a diff applied to `learner_concept_state`:

| Signal | Trigger | Update |
|---|---|---|
| `encounter` | concept's feature pattern appears in input (even in agent replies) | `encounters++` |
| `production` | user produces the feature | `productions++` |
| `correct_production` | user produces it without violation | `correct_productions++`, FSRS concept update |
| `error_production` | rule-based violation fires | `error_count++`, `last_error_at`, bumps into SRS |
| `recall` | user reviews it explicitly (review UI) | `recalls++`, FSRS concept update |
| `correct_recall` | recall quality ≥ 3 | `correct_recalls++`, FSRS positive rating |

Error-production signals are the heaviest — they force the concept into the SRS schedule. Correct-production is the lightest — a bump but no immediate review.

## Aggregate feature computation

Per message, computed in one pass from CoNLL-U:

```typescript
interface MessageFeatures {
  token_count: number;
  sentence_count: number;
  mlu: number;                       // mean tokens per sentence
  type_token_ratio: number;          // unique lemmas / total content words
  subordination_ratio: number;       // count of (acl:*, advcl, ccomp, xcomp, csubj) / T-units
  lexical_rarity_p50: number;        // median frequency rank of content lemmas
  lexical_rarity_p90: number;        // 90th percentile
  error_count: number;               // rule-detected violations
  spelling_error_count: number;      // nspell-detected
  concepticon_coverage: number;      // content lemmas resolved to Concepticon / total
}
```

These roll up nightly per `(user, language)` for the CEFR band estimator (see `docs/LEARNING-MODEL.md`).

## Lexis extraction

Each content-word lemma (UPOS in NOUN, VERB, ADJ, ADV, PROPN) gets:

1. Lookup in the per-language `lemma_to_concepticon` map. This map is seeded from:
   - Concepticon's lexibank datasets where available per language.
   - Wiktionary interlanguage links as a bulk supplement.
   - Per-language hand-curation for the top 2,000 frequency tokens.
2. If found: the lemma contributes to both the language-specific `vocabulary` row and the universal `u:lexis:concepticon=<id>` concept.
3. If not found: the lemma is `vocabulary`-only for now. Flagged for enrichment.

Why bother with Concepticon mapping? Cross-language aggregation of vocabulary competence. A learner who knows `aller` in French and `ir` in Spanish should get credit for the `GO` concept across both — and when they start Italian, `andare` is preloaded as "exposed."

## Performance targets

- **Parse latency**: p50 < 100ms, p95 < 300ms for a typical 20-token message.
- **Memory**: ~500MB per loaded language model. Preload only user's active languages per process.
- **Throughput**: 10 messages/sec per CPU core (well beyond single-user need).
- **Startup cost**: 2–5s per language for model load, amortised over process lifetime.

If these targets slip, the optimisation path is: (1) quantise Stanza models, (2) move to `udpipe-rs` for the hot path, (3) shared-memory IPC instead of stdio. Don't optimise until measured.

## Testing

Every rule has at least three fixtures in `tests/parsing/fixtures/<lang>/`:

- Positive: text that triggers the rule.
- Negative: text that *doesn't* trigger the rule but is superficially similar.
- Edge: boundary cases (quote marks, contractions, proper nouns).

Full rule suite runs on every PR (layer 2 contract tests in `docs/TESTING.md`). Takes <30s for all languages.

The eval harness (layer 5) runs 200 real learner utterances per language and scores the parser's rule-detection recall and precision against human-labelled errors. Regression of >5% on either metric blocks release.

## Future: L1-sensitive parsing

Phase 3+. A learner's L1 changes which errors are *likely*. A parser doesn't use that prior today; the rule engine does (rules can gate on `l1` in the context). Longer-term: train a per-L1 error-pattern classifier on the stored `review_log`-style error history, bias the LLM explainer with L1-specific expectations (already in the plan via `docs/LEARNING-MODEL.md`'s L1 priors, but the deterministic side can get tighter too).

## Summary

- Parse every message deterministically with a UD-compliant parser (Stanza primary, Trankit fallback, FST analyzers for morphology-heavy languages).
- Map parse features to universal concepts via a seeded `concept_feature_index`.
- Detect violations via declarative per-language rule files.
- Update per-concept competence state from the parse.
- Only invoke Opus when the deterministic pass can't fully explain a finding.

This is the backbone that lets us claim measurable competence. Without it, "the user is B1 in French morphology" is handwaving. With it, it's the sum of specific concept scores with traceable evidence.
