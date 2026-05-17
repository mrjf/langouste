# Bug: vocabulary accuracy reads 100% for words the user only got right after AI correction

**Labels:** `bug`, `pedagogy`, `srs`, `priority:high`

## Summary

A vocabulary item's accuracy (`correct_productions / productions`) is reported as 100% even when the user originally misspelled or misused the word, saw an inline AI correction, fixed their own message, and only then sent it. The original error is invisible to the tracker. It should count as a miss — the learner did not produce the item correctly cold.

## Steps to reproduce

1. Start a French conversation (any agent).
2. Compose a message containing a target word the system will recognise as vocabulary — e.g. write `j'ai acheter du pain` (wrong: `acheter` should be `acheté`).
3. Wait for the deterministic spell-check + Opus explanation to surface the error inline.
4. Fix the message in place (`j'ai acheté du pain`) and press Enter.
5. Open the profile / vocabulary panel and inspect the accuracy roll-up for `acheter` (or `acheté`).

## Expected

The roll-up for that token reflects a missed first attempt. Concretely:

- `productions` increments by 1, `correct_productions` does **not** increment, OR
- A new outcome (`self_corrected`) is recorded distinct from both `correct` and `incorrect`, surfaced separately in the UI so accuracy ≠ 100%.

The corresponding `review_log` row carries enough state to reconstruct the sequence (first-attempt outcome + final-message outcome) so the eval harness can replay it.

## Actual

The roll-up shows `productions = 1`, `correct_productions = 1`, accuracy = **100%**. No record of the first-attempt error exists on the vocabulary row. The pre-send self-correction is invisible to `trackLearningProgress`.

## Root cause

The chat pipeline runs vocabulary extraction (`VocabularyExtractionOutput`) against the **final, sent** message — i.e. after the user has applied any inline self-corrections. `trackLearningProgress` then records every item in `new_vocabulary` as `outcome: "correct"`:

```ts
// src/services/spaced-repetition/tracker.ts:19-35
const vocabPromises = aiResult.new_vocabulary.map((v) =>
  recordInteraction(db, {
    userId,
    language,
    itemType: "vocabulary",
    lookupKey: v.term,
    seed: { /* ... */ },
    eventType: "production",
    outcome: "correct",      // <-- unconditional; the pre-correction error is gone
    source: "chat_produce",
    messageId,
  }),
);
```

By the time `trackLearningProgress` runs, the corrections diff has been resolved and discarded for vocabulary purposes — only grammar gaps that survived to the sent message are flagged as `outcome: "incorrect"`. A vocabulary item that triggered a squiggle but was corrected before send leaves no trace on the vocabulary row.

This violates first principle 1 in `docs/LEARNING-MODEL.md` (*"The learner stays in control. We never rewrite their message. We surface errors; they fix them."*) on the assessment side: the principle assumes we *measure* the struggle even though we don't *rewrite* the message. Today we measure neither.

Related code:

- `src/services/spaced-repetition/tracker.ts` — `trackLearningProgress` (the immediate offender)
- `src/services/spaced-repetition/interactions.ts` — `recordInteraction`, `Outcome` type, `resolveQuality` (would need a new outcome value or a different quality mapping for self-corrections)
- `src/services/ai/` — vocabulary extraction is currently run only on the final message; needs to also know which spans were self-corrected (or run on both pre- and post-correction text)
- The chat client (`src/client/`) — needs to surface the pre-correction state to the backend, since the in-flow squiggle interactions happen client-side

## Suggested fix

Smallest viable change:

1. **Capture the self-correction event client-side.** When the user accepts/edits in response to a squiggle on a vocabulary span, emit a `self_corrected_spans: { term, original, corrected }[]` payload alongside the final message on send.
2. **Extend the `Outcome` enum** in `src/services/spaced-repetition/interactions.ts` with `"self_corrected"` (distinct from `"correct"` and `"incorrect"`). Map it in `resolveQuality` to **quality 2** — better than an uncorrected miss (1), worse than a cold-correct production (4). This matches SM-2's "incorrect response; the correct one remembered" semantics.
3. **Branch in `trackLearningProgress`.** Before recording `outcome: "correct"` for an extracted vocabulary item, check whether its `term` (or a normalised form) appears in `self_corrected_spans`. If so, record `outcome: "self_corrected"` instead.
4. **Roll-up column.** Add `self_corrected_productions integer NOT NULL DEFAULT 0` to `vocabulary` (and `grammar_gaps` for symmetry), and update `recordInteraction` to bump it. Accuracy in the profile becomes `correct_productions / productions` (unchanged math, but `correct_productions` no longer over-counts) and the UI gains a third number: "produced cleanly N / self-corrected M / errored K."
5. **`review_log`.** No schema change needed — `outcome` is a free-form string column. The new value flows through automatically and the eval harness can filter on it.

Migration cost: one schema migration, three or four touchpoints in the chat pipeline, two enum additions. Tests in `tests/spaced-repetition/` need a new fixture for the self-correction flow.

## Test cases to add

- User produces a vocab item correctly cold → `productions++`, `correct_productions++`, accuracy stays accurate.
- User produces wrong, accepts squiggle fix, sends → `productions++`, `self_corrected_productions++`, `correct_productions` unchanged, accuracy reflects the miss.
- User produces wrong, ignores squiggle, sends → `productions++`, accuracy reflects the miss (existing behaviour, regression test).
- User produces wrong, accepts squiggle fix, edits further, still wrong, sends → both `self_corrected_productions++` and `error_count++` (or the equivalent for grammar gaps).
- Item is encountered (agent uses it) but not produced → `encounters++` only; no change to accuracy. (Existing behaviour, regression test.)

## Pedagogical context

Self-correction is a real learning event — Lyster & Saito (2010) on prompts vs recasts, cited in `docs/LEARNING-MODEL.md` first principles — but it is not equivalent to producing the item cleanly. Treating it as `correct` collapses the signal that the SRS scheduler and CEFR band estimator both rely on. Downstream effects: items get over-credited and scheduled less aggressively than they should be; the CEFR band estimator's `error_rate` feature is depressed; the "where data agrees vs disagrees with the literature" digest from the empirical learning loop (`docs/LEARNING-MODEL.md` § "Empirical learning loop") gets a noisy input.

This is the kind of measurement leak that quietly degrades every downstream pedagogy claim. Worth fixing before the empirical loop ships, otherwise the loop trains on a biased signal.
