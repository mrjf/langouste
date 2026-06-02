# Langouste documentation

Start here. The docs are layered — read in order if you're new, jump to the relevant one if you're not.

## For everyone

- [VISION.md](../VISION.md) — the product vision, high level.
- [ROADMAP.md](./ROADMAP.md) — phased plan from current state to v1, with exit criteria per phase.
- [MARKETING.md](./MARKETING.md) — positioning, target audiences, launch channels. Informs the public-facing copy.

## Pedagogy

- [ONTOLOGY.md](./ONTOLOGY.md) — **read this first for anything pedagogy-related.** The seven-dimension map, the concept taxonomy built on Universal Dependencies / UniMorph / Concepticon / PHOIBLE, and the per-dimension band vector.
- [LANGUAGE-REFERENCE.md](./LANGUAGE-REFERENCE.md) — the language-side projection of the same ontology: reference pages for how each language realizes each universal feature, with dense links to grammars, papers, typological databases, corpora, and pedagogical resources.
- [PARSING.md](./PARSING.md) — the deterministic parsing pipeline that extracts UD features from every message. Feeds the ontology.
- [LEARNING-MODEL.md](./LEARNING-MODEL.md) — how we measure, explain, and schedule. SRS, CEFR estimation, L1 priors, self-correction flow. Sits on top of the ontology and parsing.
- [LEARNING-TRACKING.md](./LEARNING-TRACKING.md) — implementation contract for seen/produced/error/quiz events, `review_log`, concept-level FSRS state, due-review selection, and profile sync.
- [REFERENCES.md](./REFERENCES.md) — external URL templates, ingestion sources, and the reference-links service.

## Engineering

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system shape, Claude Code integration, MCP server surface, streaming pipeline, OpenClaw, sandboxing.
- [MODES.md](./MODES.md) — sqlite vs supabase deployment modes and how to pick one.
- [message-processing.md](./message-processing.md) — the per-message pipeline spec.
- [TESTING.md](./TESTING.md) — five-layer testing strategy including the pedagogical eval harness.
- [RELEASE.md](./RELEASE.md) — two deployment tiers, versioning, migrations, rollbacks, feature flags.

## Landscape

- [PRIOR-ART.md](./PRIOR-ART.md) — adjacent projects in the SRS / LLM-flashcards / agent-driven-review space, with notes on how Langouste differs and where to embed vs reinvent.

## If you're trying to…

- **Contribute a new language** → `LANGUAGE-REFERENCE.md` (language overview + concept realizations), `ONTOLOGY.md` (concept catalog, applicability rows), `PARSING.md` (per-language rules + parser availability), `REFERENCES.md` (URL templates), `LEARNING-MODEL.md` (L1 priors).
- **Add a new agent connector** → `ARCHITECTURE.md` (connector pattern), `src/services/agents/` (existing examples).
- **Change pedagogy** → `LEARNING-MODEL.md` (the why), `ONTOLOGY.md` (the what), `LEARNING-TRACKING.md` (the event/state contract), `TESTING.md` (prove you didn't break it).
- **Ship a release** → `RELEASE.md`.
- **Talk about Langouste publicly** → `MARKETING.md`.
