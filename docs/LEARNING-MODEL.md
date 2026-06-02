# Learning Model

How Langouste tracks, explains, and advances a user's language ability. The design is pedagogy-first — every mechanical choice (SRS algorithm, CEFR band vs point estimate, when to reveal the answer) is grounded in a specific claim from the second-language-acquisition literature.

This is not a product description. It's the source of truth for *why* the system behaves the way it does. When in doubt during implementation, come back here.

**Read `docs/ONTOLOGY.md` first.** This doc describes *how we teach and track*; ONTOLOGY describes *the structured map of the language skill itself* — the seven dimensions, the concept taxonomy, the per-dimension band vector. This doc's CEFR estimator, SRS, and error-handling sit on top of that ontology. For the concrete seen/produced/error/quiz event contract, read `docs/LEARNING-TRACKING.md`.

## First principles

1. **The learner stays in control.** We never rewrite their message. We surface errors; they fix them. Supported by Lyster & Saito's (2010) meta-analysis showing *prompts* (eliciting self-correction) produce more durable uptake than *recasts* (implicit reformulation).
2. **Productive struggle before comfort.** Show target-language content first; reveal L1 translation only after effort. Supported by Swain's (1985, 1995) pushed-output hypothesis and Bjork & Bjork's (2011) *desirable difficulties* framework.
3. **In-context learning beats drills.** Grammar and vocabulary extraction happens from real messages the user sent with intent. Ellis (2006) on focus-on-form vs focus-on-forms.
4. **Comprehensibility budget is a property of the surface, not the learner.** The widely-cited 95–98% threshold (Nation 2006, Hu & Nation 2000, Laufer & Ravenhorst-Kalovski 2010, Kremmel 2023) was empirically derived from *unaided* extensive reading. Different surfaces in Langouste offer different scaffolding (per-word glosses, full Opus explanations, in-flow chat with limited interruption, single-item review focus) and therefore tolerate — and benefit from — different unknown-token rates. The deeper principle from Schmidt's noticing hypothesis: 100% coverage is the *worst* condition for acquisition because nothing gets noticed. Optimal is "maximize productively-noticed unknowns" within the surface's cognitive-load ceiling. See the per-surface table in the "Comprehensible input across surfaces" section below.
5. **Honest uncertainty about level.** CEFR is a band, not a point. We display bands (`A2–B1`) and back them with feature evidence.
6. **Interleave, don't segment.** Vocabulary and grammar items mix in review sessions. Rohrer & Taylor (2007); Nakata & Suzuki (2019) for vocabulary specifically.
7. **Log everything, forever.** Every review, correction, and message gets recorded. Required for FSRS parameter fitting, eval harnesses, and research.
8. **Empirical over received wisdom.** Every pedagogical claim in this doc is provisional until validated against Langouste's own users. The literature gets us a strong prior; the data gets us the posterior. See the "Empirical learning loop" section below for the specific mechanism — opt-in anonymized telemetry, per-surface A/B infrastructure, monthly digest of which design choices the data agrees and disagrees with the literature on. Where we find divergence, we update *this doc* — it is not a frozen artifact.

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
  quality                  -- 0–5 recall/production quality, mapped to FSRS Again/Hard/Good/Easy
  reviewed_at
  before_state, after_state -- jsonb snapshot of item roll-ups + FSRS state before/after
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

## SRS: FSRS by default

FSRS (Free Spaced Repetition Scheduler — Ye 2022, currently at FSRS-6) is the default scheduler. The evidence shifted decisively between 2024 and 2026: Anki made FSRS its default in 2025; the open-spaced-repetition benchmark shows FSRS-6 produces more accurate recall predictions than SM-2 for **~99.5% of users tested**; FSRS schedules reviews with ±5.3% deviation from target retention vs SM-2's ±16.2% at 90% retention; and applied trials show **20–30% fewer reviews for the same retention rate** (Academic Medicine 2025 trial, n=26,000+ physicians: 58% retention vs 43% control).

There's also a qualitative win: FSRS models difficulty with **mean reversion** — multiple correct answers gradually return difficulty to a baseline rather than ratcheting ease permanently downward. This eliminates SM-2's "ease hell" failure mode entirely, where cards a user once stumbled on stay near-daily forever.

Implementation:

1. **`recordInteraction(input)`** is the single write boundary. It appends to `review_log`, updates vocabulary/grammar roll-ups, and schedules the atomic concept through `fsrs.ts`.
2. **Concept state is authoritative.** `concept_srs` is keyed by `(user_id, language, concept_id)` and stores `{difficulty, stability, retrievability, interval_days, lapses, next_review_at}`. Vocabulary and grammar rows mirror the next-review fields only for UI/API compatibility.
3. **FSRS and signal weights are tunable.** `fsrs_configs` is keyed by `(user_id, language)` and stores the 21 FSRS parameters, target retention, maximum interval, failure retry delay, and `quality_weights` for interaction signals. Example keys: `production:correct`, `production:incorrect`, `chat_self_correct:production:incorrect`, `exercise:production:partial`. Values are scheduler quality scores `0–5`; `null` means "observe but do not schedule."
4. **Per-user parameter fitting** runs as a nightly job once that user has ≥ 200 review events in `review_log`. Below that, the default parameter set from open-spaced-repetition's pooled fit is used — already better than SM-2 cold.
5. **`review_log` is non-negotiable** — without it, per-user FSRS fitting can't happen and we're stuck on default parameters forever.

The principle from the SM-2 era still holds: the scheduler is a pure function over `(concept_state, quality, now) → next_state`. Testable, deterministic, swappable.

For the full implementation contract — encounter vs production vs recall events, self-correction as failed production, quiz result scoring, due-review selection, and database-sync invariants — see `docs/LEARNING-TRACKING.md`.

## Comprehensible input across surfaces

The 95–98% rule (Nation 2006; Hu & Nation 2000; Laufer & Ravenhorst-Kalovski 2010; replicated Kremmel 2023) was derived from one specific experimental condition: **unaided extensive reading for pleasure**. Generalizing it as a global app-wide rule is a category error. With scaffolding present, the threshold drops substantially, and meta-analyses of glossed input (Yanagisawa/Webb/Uchihara; Chen 2025 in *TESOL Quarterly*) consistently show that **glossed text at 90% coverage acquires more vocabulary than unglossed text at 98%** — the gloss converts opaque unknowns into explicit noticing events (Schmidt's noticing hypothesis).

The real ceiling, regardless of scaffolding, is cognitive load (Sweller): no amount of glossing rescues a sentence with eight simultaneous unknowns, because working memory can't hold them plus the syntax plus the meaning. Sweet-spot reported in CLT-informed L2 work is ≤ 2 unknowns per sentence for *intensive* (fully-scaffolded) reading.

So Langouste applies a **per-surface budget**:

| Surface | Scaffolding available | Coverage target | Unknowns-per-sentence cap | Rationale |
|---|---|---|---|---|
| Agent chat reply (Claude Code) | In-flow only — learner can tap a word but it breaks conversational flow | ≥ 95% | ≤ 1 per sentence on average | Closest to Hu & Nation 2000's unaided condition. Includes a *floor* (see below) — at least one stretch exemplar per turn — operationalizing Schmidt. |
| Correction explanation (Opus) | Full L1 explicit instruction, full attention, no time pressure | n/a — coverage of the target-language example is irrelevant | Constrain by *concept load*: ≤ 1 new grammar concept per explanation | The explanation **is** the scaffold; what matters is not packing three new ideas into one. |
| Review card (SRS) | Full scaffolding, single-item focus | n/a — coverage is 0% by design | n/a | Encoding-then-retrieval (Conti 2026 recalibration) — don't schedule a card for recall until it has been encountered in context ≥ N times. |
| Generated reading passage, casual mode | Tap-to-gloss available | ≥ 95% | ≤ 1 per sentence | Treat as extensive reading with light support. |
| Generated reading passage, intensive mode | Tap-to-gloss + concept notes + grammar sidebar | 85–92% | ≤ 2 per sentence | Deliberately stretched. Produces more notice-events per minute than casual mode at the same fluency. |
| Ambient listening capture | None — the world delivers what it delivers | Whatever it is | Don't gate | Pure observation surface; no constraint to enforce. |

The agent-chat row keeps the two-sided shape we already had:

1. **Ceiling: ≥ 95% known-lemma coverage.** Compressed summary of known lemmas injected per session: "Target ≥95% coverage. Gloss any rarer word in parentheses in the learner's L1 on first use."
2. **Floor: ≥ 1 stretch exemplar per turn.** Up to 3 concepts drawn from `grammar_gaps`, ranked by `last_error_at × ease_factor`: "Include at least one natural in-context exemplar of each. Do not flag them — they should appear as if you'd have used them anyway."
3. **Post-turn verifier.** Sonnet re-parses the reply through `docs/PARSING.md` and checks both sides. Retry once on violation; on second failure, accept and log `gate_miss` for the eval harness.
4. **Exposure tracking.** Unknown content words land in `vocabulary` as exposure items, not immediately `due_for_review`. Stretch exemplars are auto-promoted to candidate-for-review on the next session.

The framing matters because "we hit 95% coverage" is half the story. "We hit 95% coverage *and* landed three stretch items *and* the user noticed them *and* they comprehended the turn" is the actual learning event. Each row in the table above has its own per-event success metric; they roll up into the eval harness (see "Empirical learning loop" below).

## Empirical learning loop

Everything above is a strong prior, not a frozen truth. Every design choice — the per-surface coverage targets, the FSRS default parameters, the exposure → practice → recall thresholds, the L1-interference priors, the scaffolded-reveal timing — is testable against real user behavior, and we test all of them.

Mechanism:

1. **Opt-in anonymized telemetry.** On signup, a clear toggle: "Help improve Langouste — share anonymized learning event data (messages, corrections, review outcomes; no personally identifying content)." Opt-in, not opt-out. Defaults off in self-hosted single-binary mode; defaults to *prompt-on-first-launch* in the managed tier. Telemetry payload schema is open and documented in `docs/TESTING.md`.
2. **Per-surface A/B infrastructure.** A lightweight experiment harness routes a fraction of opted-in users to alternative settings: e.g. 95% vs 92% coverage target on agent chat; FSRS-6 default parameters vs per-user fit at 100 vs 500 review events; stretch-floor of 1 vs 2 exemplars per turn; reveal-delay of 10 s vs 15 s vs 30 s. Each experiment carries a hypothesis ("lowering coverage to 92% will increase notice-events without harming comprehension") and a stop rule.
3. **Outcome metrics, per experiment.** For each variant, track: notice-events (lemma exposures that the user later interacted with — clicked for gloss, asked the agent about, or answered correctly in review), 30-day retention on items first seen during the variant, comprehension-gate answer correctness, self-correction success rate, session-length and return-frequency, and explicit user satisfaction signals (thumbs on individual replies).
4. **Monthly synthesis.** Automated digest: "These design choices the data agrees with the literature on. These choices the data disagrees on. These are inconclusive." Disagreements update *this doc* — including potentially the per-surface thresholds, the noticing-vs-fluency tradeoff, the exposure → practice → recall sequencing, and the SRS scheduler parameters. The doc is the spec, not the scripture.
5. **Eval harness as the gatekeeper.** Before any change to a pedagogical default ships globally, it has to clear the offline eval harness (`docs/TESTING.md`) on retained held-out user trajectories. The harness replays historical sessions through the new logic and reports whether outcome metrics would have improved or regressed.
6. **L1-priors learn too.** The per-(L1, L2) interference paragraphs in `assets/l1-priors/` start as hand-authored from Swan & Smith. They get supplemented by patterns the data surfaces: if French learners with EN-L1 consistently make a specific error not in the Swan & Smith list, the system flags it, a human reviewer confirms or rejects, and the prior gets updated. The prior file itself is versioned and changes are auditable.
7. **Honest failure publication.** When an experiment shows a literature-supported choice doesn't replicate on Langouste's users, we say so — in `docs/LEARNING-MODEL.md` revisions, in `docs/MARKETING.md`, and (post-v1) in a periodic public methods post. "We tried X, the literature said Y, our data showed Z" is more credible than a doc that always agrees with itself.

The bet underneath this loop: a pedagogical system that gets measurably better every month from its own deployment data ends up substantially ahead of one that ships with the textbook answer and never re-checks. The literature is a strong start. The deployment is the actual experiment.

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

### Added 2026 (post-original-draft, supporting current revisions)

- Conti, G. (2025). *Why the input we give our learners must be 95–98% comprehensible* — literature review consolidating Nation's threshold across 2010s–2020s replication studies. [The Language Gym, Feb 2025](https://gianfrancoconti.com/2025/02/27/why-the-input-we-give-our-learners-must-be-95-98-comprehensible-in-order-to-enhance-language-acquisition-the-theory-and-the-research-evidence/).
- Conti, G. (2026). *Have We Overdone Retrieval Practice? A Timely Recalibration for Language Teachers* — argues that retrieval before sufficient initial encoding wastes effort; informs our exposure → practice → recall sequencing. [The Language Gym, Apr 2026](https://gianfrancoconti.com/2026/04/14/have-we-overdone-retrieval-practice-a-timely-recalibration-for-language-teachers/).
- Frontiers in Psychology (2025). *Beyond comprehensible input: a neuro-ecological critique of Krashen's hypothesis* — input alone is insufficient; interaction + output + multimodal engagement required. [DOI 10.3389/fpsyg.2025.1636777](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1636777/full).
- Frontiers in Education (2025). *Testing Krashen's input hypothesis with AI: a mixed-methods study* — adaptive chatbot vs static script; adaptive condition wins on autonomy and self-efficacy. Underpins the two-sided gate. [DOI 10.3389/feduc.2025.1614680](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1614680/full).
- Maie, R. (2025). *Cumulative testing for L2 vocabulary learning: the impact of retrieval practice and proficiency*. TESOL Quarterly. — supports interleaved cumulative review over per-concept blocks. [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/tesq.3391).
- Open Spaced Repetition project (2025). FSRS-6 benchmark vs SM-2 over the open-spaced-repetition dataset — FSRS-6 better for ~99.5% of users. [GitHub](https://github.com/open-spaced-repetition).
- Ye, J., et al. (2024–2025). FSRS-5 / FSRS-6 algorithm releases and Anki integration; default scheduler in Anki since 2025. [Anki FAQ](https://faqs.ankiweb.net/what-spaced-repetition-algorithm).
- Hu, M. & Nation, I. S. P. (2000). *Unknown vocabulary density and reading comprehension*. The foundational study behind the 95–98% threshold — explicitly an unaided extensive-reading condition.
- Laufer, B., & Ravenhorst-Kalovski, G. C. (2010). *Lexical text coverage, learners' vocabulary size, and reading comprehension*. Distinguishes 95% minimal vs 98% optimal for unaided reading. [PDF](https://files.eric.ed.gov/fulltext/EJ887873.pdf).
- Kremmel, B. (2023). *Unknown vocabulary density and reading comprehension: replicating Hu and Nation (2000)*. *Language Learning*. Confirms threshold for unaided condition; does not generalize. [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/lang.12622).
- Chen, X. (2025). *The Effects of Gloss Language on L2 Vocabulary Learning from Reading*. TESOL Quarterly — gloss language interacts with frequency and proficiency; glossed text below 95% coverage outperforms unglossed at 98% on acquisition. [Wiley](https://onlinelibrary.wiley.com/doi/10.1002/tesq.3394).
- Yanagisawa, A., Webb, S., & Uchihara, T. *How do different forms of glossing contribute to L2 vocabulary learning from reading?* SSLA. Meta-analysis of gloss effects. [Cambridge](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/how-do-different-forms-of-glossing-contribute-to-l2-vocabulary-learning-from-reading/38124150D59DF3039EE1FF5AE88FE922).
- Schmidt, R. (1990, ongoing). The noticing hypothesis — explicit attention to form drives acquisition; 100% comprehensible input is the *worst* condition for noticing.
- Sweller, J. Cognitive load theory applied to second-language teaching. Working-memory ceiling sets the real upper bound on unknowns per sentence, regardless of scaffolding. [PDF](http://contact.teslontario.org/wp-content/uploads/2017/05/Sweller-CognitiveLoad.pdf).
