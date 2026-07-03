# Langouste

**Learn a language by actually using it — with an AI that corrects you like a good tutor, not a red pen.**

Langouste is an open-source language-learning chat app for serious self-learners. You hold a real conversation in the language you're learning; Langouste checks your mistakes, explains the corrections in your native language, translates both sides, tracks the vocabulary and grammar you're picking up, and schedules it all for review with spaced repetition.

It runs locally with your own Anthropic API key — no account, no cloud, your data stays on your machine.

> **Status:** early and developer-oriented. The shipping path today is local SQLite mode with your own Anthropic key. A Supabase mode exists for multi-user/self-hosted setups. Desktop and Docker packaging are on the [roadmap](docs/ROADMAP.md), not done yet.

## Why Langouste

Most apps drill you on flashcards you'll never say out loud. Langouste is built on the opposite bet: **you learn fastest by producing the language and getting precise, immediate feedback on what you got wrong** — then reviewing exactly those gaps until they stick.

- **You write, the AI responds — in your target language.** Real conversation, on topics you choose, at your level.
- **Mistakes are explained, never silently rewritten.** Langouste tells you *what* was wrong and *why*, in your native language, and leaves you to fix it — because the fixing is the learning.
- **Everything you touch becomes trackable.** New words, grammar gaps, things you self-corrected — all captured and fed into a spaced-repetition schedule so review targets your actual weak spots.
- **Bring your own agent.** Talk to Claude, Claude Code, an [OpenClaw](https://github.com/mrjf/langouste) gateway, or any HTTP endpoint you point it at.

## How it works

Each message you send runs through a deliberate pipeline (full spec in [docs/message-processing.md](docs/message-processing.md)):

1. **Deterministic spell-check** — instant, no LLM, catches obvious slips before you commit.
2. **Error explanation (Claude Opus)** — rich, level-aware explanations of grammar and usage errors in your base language, with rules and references.
3. **You fix your own message and send it.** Langouste never rewrites your words.
4. **The agent replies** in your target language; both sides get translated, transliterated, and (optionally) read aloud.
5. **Vocabulary & grammar extraction (Claude Sonnet)** — pulls out what you produced and encountered, and updates your learning model.
6. **Spaced-repetition scheduling** — SM-2 today, with concept-level FSRS under active development.

## Features

- Chat with **Claude, Claude Code, OpenClaw, or any HTTP endpoint** through pluggable agent connectors.
- **Error explanations** that teach — level-calibrated (CEFR), in your native language, with grammar rules.
- **Two-way translation** of every message (Claude, or Google Cloud Translation).
- **Transliteration and IPA phonetics** for non-Latin scripts and pronunciation.
- **Learning model**: tracks vocabulary, grammar gaps, productions, self-corrections, and review history.
- **Spaced repetition**: SM-2 scheduling now; concept-level FSRS and CEFR-band estimation in progress.
- **Optional text-to-speech** (ElevenLabs) with per-language voice configuration.
- **Runs fully local** with SQLite, or multi-user with **Supabase** (Auth, Postgres, Realtime, Row-Level Security).

## Stack

| Layer     | Choice                                             |
|-----------|----------------------------------------------------|
| Runtime   | [Bun](https://bun.sh)                              |
| HTTP API  | [Hono](https://hono.dev)                           |
| Frontend  | [Svelte 5](https://svelte.dev) (runes) + Vite      |
| Database  | SQLite (local, default) or Supabase (Postgres + RLS) |
| AI        | Anthropic Claude API                               |

## Quick start

**Prerequisites:** [Bun](https://bun.sh) and an [Anthropic API key](https://console.anthropic.com/).

```sh
git clone https://github.com/mrjf/langouste.git
cd langouste
cp .env.example .env      # then edit .env — see below
bun install
bun run migrate           # create the local SQLite schema
bun run dev               # Vite on :5173, Hono API on :8000
```

Before `bun run migrate`, open `.env` and set:

| Variable                | Value                                            |
|-------------------------|--------------------------------------------------|
| `DATABASE_MODE`         | `sqlite`                                          |
| `VITE_DATABASE_MODE`    | `sqlite`                                          |
| `ANTHROPIC_API_KEY`     | your key from the Anthropic Console               |
| `LANGOUSTE_JWT_SECRET`  | any long random string (`.env.example` shows how) |

Then open **http://localhost:5173**. In default SQLite mode, single-user mode is on — you're signed in automatically, no signup needed.

`.env.example` documents every option (translation provider, spell-check provider, text-to-speech, Supabase mode). Every variable the server reads is centralized in [`src/lib/config.ts`](src/lib/config.ts).

### Common commands

```sh
bun run dev          # Vite frontend + Hono backend (parallel)
bun run dev:client   # frontend only (:5173)
bun run dev:server   # backend only (:8000)
bun run build        # production frontend build
bun run migrate      # apply database migrations
bun run check        # Biome lint + format (the CI gate)
bun test             # unit tests (tests/services)
```

## Database modes

- **SQLite (default)** — zero-config, fully local, single-user. Data lives in a `langouste.db` file under your OS data directory. This is the contributor and self-learner path.
- **Supabase** — managed or self-hosted Postgres with Auth, Realtime, and Row-Level Security, for multi-user deployments.

See [docs/MODES.md](docs/MODES.md) to pick and set up a mode.

## Documentation

New here? Start with the [documentation index](docs/README.md). Highlights:

- [VISION.md](VISION.md) — what Langouste is for and the bet behind it.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system shape, agent connectors, message pipeline.
- [docs/MODES.md](docs/MODES.md) — SQLite vs Supabase.
- [docs/LEARNING-MODEL.md](docs/LEARNING-MODEL.md) — how progress is measured, explained, and scheduled.
- [docs/ROADMAP.md](docs/ROADMAP.md) — where the project is and where it's going.
- [CONTRIBUTING.md](CONTRIBUTING.md) — local quality gates and how to send a change.

## Contributing

Contributions are welcome. The short version: run `bun run check` and `bun test` before you push (they're the blocking CI gates), match the existing style, and keep changes focused. Full details, including the type-check backlog and how to add a language or an agent connector, are in [CONTRIBUTING.md](CONTRIBUTING.md) and the [docs index](docs/README.md). Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Privacy

Local (SQLite) mode keeps your application data on your machine. Messages are still sent to the AI and translation providers you configure when those features run. See [PRIVACY.md](PRIVACY.md).

## Security

Please don't open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md) for private reporting.

## License

Langouste is released under the [MIT License](LICENSE). It vendors two first-party MIT libraries, [`filo/`](filo) (text annotation) and [`lit/`](lit) (transliteration), each with its own LICENSE file.
