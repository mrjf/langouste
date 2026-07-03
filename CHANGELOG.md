# Changelog

All notable changes to Langouste will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning once stable releases begin. While the project is pre-1.0, minor versions may include breaking changes.

## [Unreleased]

This is the initial public open-source release. It gathers the work done to date
into a documented, installable project.

### Added

- **Conversational learning loop.** Chat with an AI agent in your target
  language; deterministic spell-check, Claude Opus error explanations, and a
  "you fix your own message" flow that never rewrites your words.
- **Agent connectors.** Pluggable connectors for Claude, Claude Code, OpenClaw,
  and any HTTP endpoint (`src/services/agents/`).
- **Translation, transliteration, and IPA phonetics** for both sides of every
  message, via Claude or Google Cloud Translation.
- **Learning model.** Vocabulary and grammar-gap extraction (Claude Sonnet),
  self-correction tracking, and review history.
- **Spaced repetition.** SM-2 scheduling, with concept-level FSRS state and
  CEFR-band estimation under active development.
- **Optional text-to-speech** (ElevenLabs) with per-language voice configuration.
- **Two database modes.** Local SQLite (default, single-user, zero-config) and
  Supabase (Postgres + Auth + Realtime + Row-Level Security) for multi-user.
- **Open-source project scaffolding.** MIT license (including LICENSE files for
  the vendored `filo/` and `lit/` packages), Code of Conduct, contributing
  guide, security policy, privacy policy, issue/PR templates, and CI (Biome
  lint/format, unit tests, build).
- **Documentation set** under `docs/` covering architecture, deployment modes,
  the message pipeline, the learning model and ontology, testing strategy, and
  roadmap.

### Fixed

- **Access control:** enforce conversation membership on
  `GET /api/messages/:conversationId` and
  `PATCH /api/conversations/:conversationId/connector`. Previously an
  authenticated user could read another conversation's messages or swap its
  agent connector by guessing the conversation ID (no row-level security backs
  the default SQLite mode, so these route checks are the enforcement point).
  Regression tests added in `tests/services/conversation-access.test.ts`.

### Documentation

- Rewrote the README as a proper project front page.
- Corrected `CLAUDE.md` / `AGENTS.md` command examples from `npm` to `bun`.
- Marked `docs/RELEASE.md` clearly as the target (not current) release process.
