# Authored AI language course

`authored-course.json` is source-controlled teaching content, not learner progress. Its source registry stores canonical English summaries once. Undated reference pages retain a null publication date. The installed packet contains all 60 authored lessons (30 per language), 180 reading sections, 1,080 exercises, 212 canonical lexical identities, 13 source pages and 48 shared factual sentence records.

## Ingestion

From the repository root, run:

```sh
python3 scripts/import-course.py /absolute/path/to/extracted-authored-packet
```

The full packet includes `source-registry.json`, `source-readings.json`, `vocabulary-registry.json`, `concept-registry.json`, `id-aliases.json`, `curriculum-30-days.json` and authored lesson JSON files. Shared factual sentences are resolved at runtime; lesson source lists missing in the packet are resolved from their authored curriculum assignments. Exercises that reference review targets outside the focus list resolve those targets through the course definitions. The importer preserves source input, validates the complete replacement before atomically installing it, and does not create learning records. Re-running it replaces the same installed content without duplicating lessons. Supply the complete desired packet when replacing `authored-course.json`; a partial replacement would hide omitted lessons. Stable lesson, exercise and target IDs preserve existing progress. Use a new course ID for materially revised assessments.

Matching exercises retain one authored question with independently evaluated pairs and pair-specific targets, preserving the original exercise privately. The UI strips answer-bearing source metadata before a question is attempted. Open-response questions store an ungraded self-check and show model answers; no semantic AI grading or paid service is used. Arabic script, transliteration and English option glosses are retained; glosses are revealed after an attempt except factual questions explicitly authored with visible English support.

## Learning records

Authenticated `/api/course` routes use the existing Database interface. Progress belongs to the authenticated user and lesson, with language recorded separately. Viewing authored content creates no learner events. Opening vocabulary or grammar creates an encounter. A first unaided typed recall can use the existing vocabulary/grammar interaction and FSRS pipeline. Choices, token banks, hints, reveals, self-checks and repeat attempts do not receive independent recall credit. Broad secondary target tags never score unrelated words. News literacy concepts can opt out of SRS. Completion means reading acknowledgment plus attempts, not mastery.

Repeated submission IDs and concurrent requests are deduplicated in a single server process. **Production limitation:** the existing database abstraction has no transaction spanning the SRS interaction and course progress write. Attempts and pending receipts are now durably written before SRS effects. Confirmed effects are marked afterwards; interrupted effects remain visible as uncertain and are never blindly retried. Fault-injection tests cover this. Concurrent independent server instances can still race because the adapter implements uniqueness as a read then write, not an atomic conditional insert. Production rollout needs durable idempotency/transaction support; local test success does not establish exactly-once distributed behavior.

The supported production backend remains turbopuffer. No alternate JSON/browser-storage tracker was introduced. The local QA server uses only the repository's ephemeral memory test transport; process restart discards its test history. Production persistence and credentials were not configured or tested.

## Delivery and daily work

The course is available in the existing sidebar at `#/course/hu` and `#/course/ar-EG`. Deploying the application and supplying an authenticated production backend remain separate authorized operations. The existing daily lesson automation can produce an authored packet in this format for ingestion, but its delivery has not yet been wired to this local checkout. Local imports and any local scheduler require the Mac to be online. No new scheduler, background service, public deployment, voice fallback or runtime AI call was added.

## Local preview

```sh
cd /path/to/langouste
VITE_SINGLE_USER=true bun run build
bun scripts/preview-course.ts
```

Open the printed `http://localhost:<port>/#/course/hu` or `/#/course/ar-EG` URL. Port allocation avoids conflicts. Ctrl-C stops and removes the temporary test server. This preview is explicitly ephemeral: it does not represent production persistence or update the user's real learning records. Production configuration continues to require the existing turbopuffer backend; the database bootstrap selects memory only through its guarded test configuration.

## Verified checks

- `bun run lint` and `bun run typecheck` pass.
- `VITE_SINGLE_USER=true bun run build` passes.
- Course service tests cover duplicate attempts, ownership/language isolation, sense identities, all 60 lessons, answer hiding, matching, self-assessment and injected partial-write failures.
- `bunx playwright test --config playwright.course.config.ts tests/e2e/course.spec.ts` uses installed Chrome and passed seven scenarios: both tracks on Days 1, 15 and 30 plus retry/reveal/reload/mobile behavior. Test data only; no production account was mutated.
- The broader service suite has one environment-dependent audio test failure because `ffmpeg` is unavailable on PATH. No audio dependency was installed.

The semantic self-check policy is honored even when a model string exists, so 593 exercises use rubric/self-assessment instead of rejecting grammatical alternatives. 217 use controlled typed recall, 144 choice, 73 matching and 53 ordering. Self-assessment never certifies mastery. Reading support modes and Arabic script versus Latin response modes are recorded separately. The shared lexical row uses the canonical term; distinct semantic senses have separate FSRS concept IDs and attempt evidence.
