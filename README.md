# Langouste

Langouste is an open-source language-learning chat app for serious self-learners. You write in your target language to a configured AI agent, then Langouste checks mistakes, explains corrections, translates both sides, tracks vocabulary and grammar, and schedules review with spaced repetition.

The project is early and developer-oriented. The intended default setup today is local `sqlite` mode with your own Anthropic API key.

## Features

- Chat with Claude, OpenClaw, or any HTTP endpoint through agent connectors.
- Keep learner messages intact: Langouste explains errors, but the learner fixes them.
- Translate user and agent messages.
- Track vocabulary, grammar gaps, productions, and review history.
- Schedule review with SM-2 today, with FSRS/concept-level tracking under active development.
- Run locally with SQLite, or use Supabase for Auth, Postgres, Realtime, and RLS.

## Stack

- Runtime: Bun
- HTTP API: Hono
- Frontend: Svelte 5 and Vite
- Database: SQLite or Supabase
- AI: Anthropic Claude API

## Quick Start

Prerequisites:

- Bun
- An Anthropic API key

```sh
git clone https://github.com/mrjf/langouste.git
cd langouste
cp .env.example .env
bun install
bun run migrate
bun run dev
```

Before running `bun run migrate`, edit `.env` and set:

- `DATABASE_MODE=sqlite`
- `VITE_DATABASE_MODE=sqlite`
- `ANTHROPIC_API_KEY`
- `LANGOUSTE_JWT_SECRET`

The dev server starts Vite on `http://localhost:5173` and the Hono backend on `http://localhost:8000`.

## Database Modes

SQLite mode is the contributor/default path and stores data in a local `langouste.db` file. Supabase mode is available for managed or self-hosted multi-user deployments.

See [docs/MODES.md](docs/MODES.md) for mode details and setup notes.

## Common Commands

```sh
bun run dev          # Vite frontend + Hono backend
bun run dev:client   # Vite frontend only
bun run dev:server   # Hono backend only
bun run build        # production frontend build
bun run migrate      # apply database migrations
bun run check        # Biome lint + format checks
bun test             # Bun test runner
```

## Documentation

- [VISION.md](VISION.md) explains the product vision.
- [docs/README.md](docs/README.md) is the documentation index.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers system shape and connector patterns.
- [docs/message-processing.md](docs/message-processing.md) specifies the message pipeline.
- [CONTRIBUTING.md](CONTRIBUTING.md) explains local quality gates.

## Privacy

Local mode keeps application data on your machine. Messages are still sent to configured AI and translation providers when those features run. See [PRIVACY.md](PRIVACY.md).

## Security

Please do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

Langouste is released under the [MIT License](LICENSE).
