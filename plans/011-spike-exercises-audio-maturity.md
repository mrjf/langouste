# Plan 011 (SPIKE): Assess exercises + audio surfaces and decide flag/finish/document

> **Executor instructions**: This is an **investigation/spike** plan. Determine
> the actual maturity of the exercises and audio surfaces, then recommend
> flag/finish/document per surface — do NOT rip anything out or build features
> from this plan. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/services/exercises src/services/ai/audio src/services/corpus/audio-assets.ts src/routes/api/exercises.ts src/routes/api/audio-drills.ts`

## Status

- **Priority**: P3 (direction)
- **Effort**: S (spike)
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

Two large surfaces are in ambiguous states of completeness heading into a public
release, which is the worst state for maintenance — a reader can't tell what
works:

- **Exercises**: `src/services/exercises/generator.ts` is 1,874 lines,
  `/api/exercises` is mounted, and the client **does** wire it
  (`ExercisePanel.svelte`, an `exercises` nav view in
  `src/client/components/App.svelte`). So it is *live*, not dead — but its test
  coverage and completeness relative to `docs/EXERCISE-TYPES.md` are unknown.
- **Audio**: `.env.example:74-101` has an extensive ElevenLabs voice-config
  block; `src/services/ai/audio/` + `src/services/corpus/audio-assets.ts` +
  `/api/audio-drills` exist; `AUDIO_PROVIDER` defaults to `none`. How much of the
  audio-drill/TTS surface is user-reachable vs half-built (the working tree even
  has uncommitted `audio-drill-tape` changes) is unclear.

This spike replaces guesswork with a maturity assessment and a per-surface
recommendation, so the release either ships them honestly, gates them, or
documents them as in-progress.

## Current state

- Exercises: route `src/routes/api/exercises.ts` imports real handlers
  (`getExerciseSession`, `submitExerciseAttempt`, etc.) from the 1,874-line
  generator; client `App.svelte:17,40,121,359` renders `ExercisePanel` under an
  `exercises` view. Migration `020_exercise_attempts.sql` exists. Tests:
  `tests/services/exercises.test.ts` exists — assess what it actually covers.
- Audio: `src/services/ai/audio/` (provider seam, elevenlabs-provider),
  `src/services/corpus/audio-assets.ts`, `src/routes/api/audio-drills.ts`
  (`createAudioDrillRoutes`), tests `tests/services/audio-*.test.ts`. Default
  `AUDIO_PROVIDER=none` (`src/lib/config.ts:42`). The `audio-drill-tape` service
  is mid-refactor (uncommitted working-tree changes at the time of this plan).
- `docs/EXERCISE-TYPES.md` and `docs/ROADMAP.md` (Phase 2 = "Audio & listening")
  state the intended scope — compare against reality.

## Scope

**In scope** (spike deliverables):
- A written assessment `docs/surface-maturity.md` (create) with, per surface
  (exercises, audio-drills/TTS): what's reachable end-to-end from the UI, what's
  stubbed/half-built, current test coverage, and a recommendation of
  **ship / gate-behind-flag / document-as-in-progress**.
- If the recommendation is "gate", the assessment specifies the exact flag name
  and where it'd be checked (config.ts + route + client nav) — but does NOT
  implement it in this plan.

**Out of scope**:
- Removing code, building features, or committing the in-flight
  `audio-drill-tape` changes (that's the author's WIP).
- Adding tests (recommend them; a follow-up plan writes them).
- Implementing any flag.

## Steps

### Step 1: Trace the exercises surface end-to-end

From `ExercisePanel.svelte` → `/api/exercises` → `generator.ts`, determine: can a
user actually start, answer, and get scored on an exercise today? Which of the
exercise kinds in `docs/EXERCISE-TYPES.md` are implemented vs declared? What does
`tests/services/exercises.test.ts` assert (real behavior or trivial)?

**Verify**: assessment section for exercises names reachable-vs-stubbed kinds and
the test-coverage reality.

### Step 2: Trace the audio surface end-to-end

From the client audio buttons (grep `audio`/`speaker` in `src/client`) →
`/api/audio-drills` and the message-audio path → `audio-assets.ts` /
`src/services/ai/audio/`. Determine what works with `AUDIO_PROVIDER=elevenlabs`
set, and what is scaffolding. Note the mid-refactor `audio-drill-tape` state as a
caveat (don't judge uncommitted WIP as shipped).

**Verify**: assessment section for audio distinguishes working playback from
scaffolding.

### Step 3: Recommend per surface

For each surface, recommend ship / gate / document, with one paragraph of
rationale grounded in Steps 1-2. If "gate", specify the flag (name, default,
check locations). If "document", specify the doc/`.env.example` note to add.

**Verify**: `docs/surface-maturity.md` has a clear recommendation per surface.

## Done criteria

- [ ] `docs/surface-maturity.md` exists with per-surface reachability, test
      reality, and a ship/gate/document recommendation
- [ ] No source behavior changed (`git status --porcelain` shows only the new
      doc, plus any pre-existing uncommitted WIP you did not touch)
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

- Tracing requires running the full app with real ElevenLabs credentials to know
  if audio works — if you can't determine reachability by reading + the stub
  tests, say so in the assessment rather than guessing.
- The uncommitted `audio-drill-tape` changes make the audio surface
  unassessable — note it and assess what you can.

## Maintenance notes

- Each "gate" or "document" recommendation becomes a small follow-up plan.
- Exercises is **live** (contrary to a first-glance "dead 1,800-line file"
  reading) — the real gap is likely test coverage, which folds into the broader
  test-coverage effort (plan 002's harness is the pattern).
