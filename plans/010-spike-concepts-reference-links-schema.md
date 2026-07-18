# Plan 010 (SPIKE): Design the concepts + reference_links schema the learning model needs

> **Executor instructions**: This is a **design/spike** plan. Produce a schema
> proposal, a migration draft, and an open-questions list — do NOT build the
> full feature or wire routes from this plan. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- sqlite/schema.sql supabase/migrations docs/LEARNING-MODEL.md`

## Status

- **Priority**: P2 (direction)
- **Effort**: M (spike)
- **Risk**: LOW (design + draft migration; no data change applied)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

`docs/LEARNING-MODEL.md` specifies a `concepts` catalog (stable concept IDs per
grammar/vocab item) and a `reference_links` table (Wiktionary / Tatoeba / curated
per-language links attached to corrections). Both are core to Phase 1
(L1-biased prompts and CEFR estimation key off `concept_id`; "learn more" links
key off `reference_links`). **Neither table exists.** The `grammar_gaps` and
`concept_srs` tables carry a `concept_id TEXT` column with **no `concepts` table
to reference** (`sqlite/schema.sql:96,124,151`). This spike designs the missing
schema so the learning-model work has ground to stand on.

## Current state

- `sqlite/schema.sql`: `grammar_gaps` and `vocabulary` and `concept_srs` all
  carry a bare `concept_id TEXT` (no foreign key, no `concepts` table). Comment
  at `sqlite/schema.sql:144-146` says `concept_srs` is "the scheduling source of
  truth" but the concept identity itself is undefined.
- `supabase/migrations/` has 20 numbered migrations (`001`…`020`); the next
  would be `021_*`. Migration policy is in `docs/RELEASE.md` ("every schema
  change is a new migration file; additive; test on fresh DB and upgrade").
- `docs/LEARNING-MODEL.md` describes the intended `concepts` columns
  (concept_id, language, category, name, cefr_level, reference_urls,
  description) and `reference_links` (per-correction links). Read it for the
  authoritative shape.
- `src/services/references/` (`item-reference.ts`, `grammar-reference.ts`,
  `dictionary.ts`) already builds reference URLs — a link resolver exists in
  spirit; the persistence layer is what's missing.
- **Dual-schema constraint**: any new table must be added to BOTH
  `sqlite/schema.sql` (as `CREATE TABLE IF NOT EXISTS`) and a new
  `supabase/migrations/021_*.sql` (with RLS policies matching the existing
  per-user tables). The two must stay in sync (there is currently no automated
  sync check — noted as a separate DX gap).

## Scope

**In scope** (spike deliverables):
- A design doc `docs/concepts-schema-design.md` (create) proposing the
  `concepts` and `reference_links` table shapes, keys, and FK relationships,
  reconciled with what `grammar_gaps`/`concept_srs`/`vocabulary` already assume.
- **Draft** (not applied) migration files: the SQL for the new tables for both
  sqlite and supabase, with RLS policies for supabase matching sibling tables.
- An open-questions list (seed data source, concept_id namespacing per language,
  backfill of existing `concept_id` values).

**Out of scope**:
- Applying migrations to any real database.
- Seeding concept data.
- Wiring routes or the link resolver to the new tables (future build plan).
- Changing `grammar_gaps`/`concept_srs` beyond documenting how they'd FK to
  `concepts`.

## Steps

### Step 1: Reconcile the documented shape with existing columns

Read `docs/LEARNING-MODEL.md` and the three tables that use `concept_id`. Produce
in the design doc: the `concepts` table columns; whether `concept_id` is a
natural key (e.g. `hu:grammar:definite-conjugation`) or a UUID; and how
`grammar_gaps.concept_id` / `concept_srs.concept_id` / `vocabulary.concept_id`
would FK to it (or stay soft references, given the dual-mode + additive-migration
policy).

**Verify**: design doc names every existing `concept_id` column and states the
relationship.

### Step 2: Draft the reference_links shape

From `docs/LEARNING-MODEL.md`, draft `reference_links` (link_id, correction_id
or concept_id FK, source, url, label, status, last_checked_at). Decide whether
links attach to a correction (JSONB corrections are stored inline per CLAUDE.md
— "Corrections stored as JSONB, not separate rows") or to a concept. This is a
real tension: corrections are JSONB, not rows, so a `correction_id` FK may not
exist. Resolve it in the doc (recommend attaching links to `concept_id`, or to
message+span) — this is the key open question.

**Verify**: design doc addresses the corrections-are-JSONB constraint explicitly.

### Step 3: Draft both migrations

Write the SQL as **draft files** the maintainer can review:
- `sqlite/schema.sql` additions (as a diff/snippet in the design doc, or a
  proposed edit — do not silently edit the live schema without calling it out).
- `supabase/migrations/021_concepts_and_reference_links.sql` with `CREATE TABLE`
  + RLS policies mirroring an existing per-user table (copy the policy pattern
  from a recent migration, e.g. the grammar_gaps or vocabulary policies).

Keep them additive (nullable columns, no destructive changes) per the release
policy.

**Verify**: draft SQL exists; RLS policies present for supabase; no destructive
statements.

### Step 4: Report open questions

List: concept_id namespacing, seed-data source (per-language grammar maps in
`docs/REFERENCES.md`), backfill strategy for existing `concept_id` values, and
the corrections-JSONB vs reference_links relationship decision.

## Done criteria

- [ ] `docs/concepts-schema-design.md` exists, reconciles `concepts` with the
      three existing `concept_id` columns, and resolves the corrections-JSONB
      tension for `reference_links`
- [ ] Draft SQL for both sqlite and a new `021_*` supabase migration (with RLS),
      additive only
- [ ] Open-questions list for the maintainer
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

- `docs/LEARNING-MODEL.md`'s specified shape conflicts irreconcilably with the
  existing `concept_id` columns — surface the conflict, don't paper over it.
- Applying anything to a real DB is required to proceed — it isn't; this is
  paper + draft files only.

## Maintenance notes

- Building the tables + seed + route wiring is a **separate** plan authored from
  this design.
- Ties into the schema-sync DX gap: whatever lands must go into both schemas;
  recommend adding the sync check (separate DX plan) around the same time.
