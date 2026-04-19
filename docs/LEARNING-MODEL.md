# Learning Model

How Langouste tracks, explains, and advances a user's language ability. The design is pedagogy-first — every mechanical choice (SRS algorithm, CEFR band vs point estimate, when to reveal the answer) is grounded in a specific claim from the second-language-acquisition literature.

This is not a product description. It's the source of truth for *why* the system behaves the way it does. When in doubt during implementation, come back here.

**Read `docs/ONTOLOGY.md` first.** This doc describes *how we teach and track*; ONTOLOGY describes *the structured map of the language skill itself* — the seven dimensions, the concept taxonomy, the per-dimension band vector. This doc's CEFR estimator, SRS, and error-handling sit on top of that ontology.

## First principles

1. **The learner stays in control.** We never rewrite their message. We surface errors; they fix them. Supported by Lyster & Saito's (2010) meta-analysis showing *prompts* (eliciting self-correction) produce more durable uptake than *recasts* (implicit reformulation).
2. **Productive struggle before comfort.** Show target-language content first; reveal L1 translation only after effort. Supported by Swain's (1985, 1995) pushed-output hypothesis and Bjork & Bjork's (2011) *desirable difficulties* framework.
3. **In-context learning beats drills.** Grammar and vocabulary extraction happens from real messages the user sent with intent. Ellis (2006) on focus-on-form vs focus-on-forms.
4. **Comprehensible input ≈ 95% known.** Replies from Claude should be roughly at the user's level, with the unknown 5% providing the growth surface. Nation (2006) on lexical coverage for comprehension.
5. **Honest uncertainty about level.** CEFR is a band, not a point. We display bands (`A2–B1`) and back them with feature evidence.
6. **Interleave, don't segment.** Vocabulary and grammar items mix in review sessions. Rohrer & Taylor (2007); Nakata & Suzuki (2019) for vocabulary specifically.
7. **Log everything, forever.** Every review, correction, and message gets recorded. Enables future FSRS migration, eval harnesses, and research.

## The data model

### Per-user, per-language state

```
profiles
  user_id
  base_languages           -- L1 list; first is primary for hints
  learning_languages       -- [{lang, cefr_level, assessed_at}]

assessments                -- CEFR band history per language
  user_id, language
  cefr_band                -- new: "A2", "A2-B1", "B1" etc.
  cefr_confidence          -- new: 0.0–1.0
  feature_snapshot         -- jsonb: MLU, TTR, subordination_ratio, err_rate, lex_rarity_p50
  assessed_at

vocabulary                 -- per-term knowledge state
  vocab_id, user_id, language, term, translation
  context_sentence, cefr_level
  ease_factor, interval_days, repetitions
  next_review_at, last_reviewed_at

grammar_gaps               -- per-concept knowledge state
  gap_id, user_id, language
  category                 -- e.g., "verb:passé_composé"
  concept_id               -- new: FK to concepts catalog (see below)
  description
  error_count, last_error_at
  ease_factor, interval_days, repetitions
  next_review_at, last_reviewed_at

review_log                 -- NEW: every review event, append-only
  log_id, user_id, language
  item_type                -- "vocabulary" | "grammar"
  item_id                  -- FK to vocabulary.vocab_id or grammar_gaps.gap_id
  quality                  -- 0–5 SM-2 quality
  reviewed_at
  before_state, after_state -- jsonb snapshot of SRS fields before/after
```

The `review_log` is critical. FSRS (Free Spaced Repetition Scheduler — Jarrett Ye, used by Anki) needs review history to fit its three-component memory model. We're not migrating now, but capturing the log from day one means migration is a schema-only change later. Ignore this and you'll need to start cold when the evidence for FSRS becomes overwhelming.

### Concepts catalog

A canonical list of grammar concepts per language, L1-independent. Seeded from the per-language grammar maps in `docs/REFERENCES.md`. Let learners accumulate progress against stable IDs instead of ad-hoc category strings.

```
concepts
  concept_id               -- stable, human-readable slug e.g. "fr:verb:passe-compose-etre"
  language
  category                 -- "verb" | "noun" | "article" | "pronoun" | "syntax" | "pragmatics"
  name                     -- "Passé composé with être"
  cefr_level               -- A1..C2
  reference_urls           -- jsonb: {wiktionary, lingolia, kwiziq, ...}
  description
```

When Sonnet extracts a grammar gap, its `category` string is mapped to a `concept_id` by fuzzy lookup against the seed list. New gaps that don't match create an unlinked gap (flagged for human review) — better than silently inventing new categories forever.

### Reference link registry

Stored per correction, but derived deterministically from URL templates (see `docs/REFERENCES.md`). The registry is a cache and a failure-mode buffer — if a template yields a 404, the registry knows not to retry for 24 hours.

```
reference_links            -- NEW
  link_id, correction_id   -- FK to the correction row
  source                   -- "wiktionary" | "lingolia" | "kwiziq" | "tatoeba" | ...
  url
  label                    -- display text
  status                   -- "ok" | "404" | "blocked"
  last_checked_at
```

## CEFR band estimation

Self-reported level at signup (optional — default `A1`). Subsequent updates come from a nightly job that analyses the last 100 user-authored messages per target language. Features, chosen for correlation with level per Vajjala & Lõo (2014) and Pilán et al. (2016):

| Feature | Computation |
|---|---|
| MLU (mean length of utterance) | mean tokens per message |
| Type-token ratio | unique lemmas ÷ total tokens |
| Subordination ratio | subordinate clauses ÷ T-units (cheap POS-tagger or Claude parse) |
| Error rate | corrections ÷ 100 tokens, from stored `corrections` |
| Lexical rarity | median word-frequency rank against FrequencyWords corpus |

Model: a simple gradient-boosted regressor trained on the MERLIN corpus (CEFR-tagged learner writing, freely available). Emits a point score plus a confidence interval; the UI shows the interval as a band (e.g. `A2–B1`). Retrain quarterly.

This is crude and honest — far better than Duolingo's widely-disputed B1 claims. We publish the method in `docs/MARKETING.md`.

## The self-correction flow

What happens when a user presses Enter:

1. **Deterministic spell/grammar check** (nspell + tokenizer). Near-instant. Squiggles appear inline.
2. **If clean**: message sends.
3. **If errors**: Opus is called with the errors, the user's L1-interference prior, and the user's current CEFR level. It produces an explanation per error, in the user's L1. The explanation is a cause ("French `aller` takes `être` in the passé composé because it's a movement verb"), not a rewrite.
4. **User revises and presses Enter again.**
5. **If still errors on the same span**: same explanation shown again.
6. **If errors persist after two attempts on the same span**: the scaffolded reveal kicks in — the corrected token is shown inline in the squiggle tooltip. This is Nassaji (2016): scaffolded help beats both "you're on your own" and "here's the answer immediately."
7. **If user edits the same span three times with new errors**: treat as `needs_gap` — force-add a grammar gap to SRS even if the vocabulary extractor didn't flag it. The user is visibly struggling with something; surface it.

## L1 interference priors

The error-explanation prompt is biased by the user's L1. For each (L1, L2) pair, a paragraph of common interference patterns — derived from Swan & Smith's *Learner English* for L2=EN and reverse-authored for the other directions.

Stored in `assets/l1-priors/<l1>-<l2>.md`, loaded at boot. v1 covers the 16 pairs in `{en, es, fr, de} × {en, es, fr, de, hu, it, pt}` minus self-pairs.

Example prepended to the Opus prompt when an English speaker learns French:

> The learner's L1 is English. Common L1→L2 interference patterns for this pair include: false friends ("actuellement" ≠ "actually"), auxiliary verb confusion (être vs avoir in compound tenses), adjective placement (pre- vs post-nominal), gendered articles (no gender in L1), and subjunctive avoidance. If the current error falls in one of these patterns, say so explicitly — it helps the learner connect this mistake to a larger pattern.

This alone measurably improves explanation quality in dogfooding. Opus is good; Opus with an L1 prior is notably better.

## SRS: SM-2 now, FSRS later

SM-2 (Piotr Wozniak, 1987) is the classic algorithm and what the code ships today. `src/services/spaced-repetition/sm2.ts` is a pure function, testable, stable.

FSRS (2022–) fits a personalised forgetting curve to each card using the user's actual review history. Anki's published benchmarks show 15–30% fewer reviews for the same retention target — meaningful, but not transformative.

Migration path:

1. **Today (v1 Phase 1):** SM-2 runs through the service boundary `scheduleNextReview(item, quality)`. Implementation lives in `sm2.ts`.
2. **When `review_log` has ≥ 1000 events for a user:** nightly job fits per-user FSRS parameters. Parameters stored on the user's profile.
3. **Feature flag rollout:** `fsrs_enabled` per user. `scheduleNextReview` routes to `fsrs.ts` when flag is on. A/B the retention rates.
4. **Default on** once A/B is conclusive. SM-2 kept as fallback for cold users.

Critically, `review_log` has to exist *today* or step 2 starts from zero. That's why the schema change is in Phase 1.

## Comprehensible input in Claude's replies

Claude Code, left alone, produces native-level prose. That's wrong comprehensible input for an A2. Two mitigations:

1. **Known-word hint in the subagent system prompt.** A compressed summary of the user's known lemmas (rough count + top-200 sample) is injected per session. The instruction: "Target 95% coverage against this learner's known vocabulary. If you must use a rarer word, gloss it in parentheses in the learner's L1 on first use."
2. **Post-hoc analysis.** After each agent turn, Sonnet analyses the reply against the user's known lemmas and flags content words outside it. These go into the vocabulary table as *exposure* items — not immediately `due_for_review`, but tracked. Exposure-to-SRS is a separate UX pass (daily digest: "you saw these 12 new words in chats yesterday — want to learn five of them?").

## Productive-struggle gate

When an agent message arrives:

1. Shown first in the user's target language, plain text (with optional TTS playback).
2. A "reveal translation" button exists but is disabled for 15 s OR until the user scrolls, clicks a word for definition, or plays audio. Active engagement unlocks the reveal.
3. After engagement, a comprehension prompt appears — a one-line question generated by Sonnet against the message ("what is the friend worried about?"). User answers in L1 or L2.
4. If the answer demonstrates understanding, the L1 translation is revealed and the message is marked `comprehended`.
5. If not, a hint shows (a key word's translation), and the user tries again.

This is Swain's output hypothesis operationalised: forced retrieval and forced paraphrase on received input. The gate is ~5 s of friction and measurably improves vocabulary retention on the specific message's tokens (measure via paired-message A/B post-launch).

## Exposure vs practice vs recall

Three distinct modalities; the current code conflates them. v1 separates.

- **Exposure**: user encountered the item (agent used a word; user read a translation). Stored with `encounters++` and `last_encounter_at`. Doesn't trigger SRS.
- **Practice**: user produced the item correctly in a message. Increments `productions`, feeds into the vocabulary cefr_level estimator.
- **Recall**: user explicitly reviewed the item (rated 0–5 in the review screen). The SRS event.

The dashboard shows all three counts. Users love seeing "you've encountered `serendipité` 4 times, used it 1 time, recalled it 2 times" — it makes progress legible.

## What success looks like

Metrics to track from day one:

| Metric | Target at v1 GA |
|---|---|
| Median CEFR band shift over 30 days of daily use | +1 sublevel |
| Recall retention at 30-day interval | ≥ 85% (SM-2 target) |
| Self-correction success rate on first retry | ≥ 60% |
| Cost per active user day | ≤ $0.50 |
| Comprehension-gate answer correctness | ≥ 70% |

Failing any of these post-launch isn't a catastrophe — but the measurement has to exist. Every metric here maps to a column we need to capture from day one.

## References cited

- Bjork, R. A., & Bjork, E. L. (2011). Making things hard on yourself, but in a good way: creating desirable difficulties to enhance learning.
- DeKeyser, R. (2007). *Practice in a Second Language*.
- Ellis, R. (2006). Current issues in the teaching of grammar: an SLA perspective.
- Krashen, S. (1982). *Principles and Practice in Second Language Acquisition*.
- Lightbown, P. M., & Spada, N. (2013). *How Languages are Learned* (4th ed.).
- Lyster, R., & Ranta, L. (1997). Corrective feedback and learner uptake.
- Lyster, R., & Saito, K. (2010). Oral feedback in classroom SLA: a meta-analysis.
- Nassaji, H. (2016). Anniversary article: interactional feedback in second language teaching and learning.
- Nation, I. S. P. (2006). How large a vocabulary is needed for reading and listening?
- Nakata, T., & Suzuki, Y. (2019). Effects of massing and spacing on the learning of semantically related and unrelated words.
- Pilán, I., Volodina, E., Borin, L. (2016). Candidate sentence selection for language learning exercises.
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning.
- Swain, M. (1985). Communicative competence: some roles of comprehensible input and comprehensible output in its development.
- Swan, M., & Smith, B. (eds.) (2001). *Learner English: A Teacher's Guide to Interference and Other Problems* (2nd ed.).
- Vajjala, S., & Lõo, K. (2014). Automatic CEFR level prediction for Estonian learner text.
- VanPatten, B. (2004). *Processing Instruction: Theory, Research, and Commentary*.
- Ye, J. (2022). FSRS: a modern spaced repetition algorithm.
