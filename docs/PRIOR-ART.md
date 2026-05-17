# Prior art & related projects

Projects in the adjacent space — spaced repetition, LLM-driven flashcards, agent-controlled review decks. Captured so we (a) don't reinvent things they've solved, (b) can point users at them when they're a better fit, and (c) have an honest answer to "how is this different from X?" Updated as new things surface.

## SRS-with-agents space

- **[Anki-LLM](https://github.com/raine/anki-llm)** by `raine` — CLI/TUI for bulk-generating and bulk-processing Anki cards with LLMs (OpenAI, Gemini, OpenRouter, Ollama-compatible). Built-in TTS audio. [Show HN, Nov 2025](https://news.ycombinator.com/item?id=45790443).
  - **What it does well:** the deck-authoring side. If you already use Anki and want LLMs to fill in fields, generate examples, or normalise a deck, this is the right tool.
  - **How Langouste differs:** Anki-LLM augments a deck the user maintains; Langouste *derives* the deck from real conversation history with no manual card authoring. The two are complementary — a Langouste export to `.apkg` (`docs/ROADMAP.md` post-v1 flashcard generation) could legitimately use Anki-LLM as the field-enrichment step rather than reimplementing it.

- **[Content-Aware Spaced Repetition](https://news.ycombinator.com/item?id=44790422)** — different angle: LLMs schedule reviews based on what's *on the card* (semantic similarity to other cards, conceptual difficulty) rather than only the user's response history.
  - **What it does well:** addresses a real SM-2/FSRS blind spot — both schedulers treat each card as an opaque atom keyed by ID, so closely-related cards don't share difficulty signal.
  - **How Langouste differs:** we get content-awareness for free from the ontology side — every vocab item carries `concept_id`, `cefr_level`, and `lemmas[]`, so the scheduler can already cluster items by shared concept. Worth watching this project for ideas on how to use the *semantic* layer (similarity embeddings between cards) on top of the *symbolic* layer (shared concept-ids) we already have.

- **[open-spaced-repetition](https://github.com/open-spaced-repetition)** GitHub organization — canonical home of FSRS itself, the open-spaced-repetition benchmark dataset, the awesome-fsrs list, and several MCP-server experiments for letting an agent drive a user's review deck.
  - **What it does well:** the algorithm (FSRS-6 as of mid-2026 — see `docs/LEARNING-MODEL.md` § "SRS: FSRS by default"), the benchmark, and the reference implementations across languages.
  - **How Langouste relates:** we adopt FSRS directly. The MCP-server experiments here are also relevant to Phase 3 of `docs/ROADMAP.md` (Langouste-as-MCP-server) — they show the shape of an "any-agent can drive my review deck" interface, which is roughly what we want to expose. Worth a closer read before we design our own MCP tool surface.

## How to use this file

When considering a new feature, scan here first. If a listed project already does the bulk of the work and can be embedded, link to it from the relevant ROADMAP item rather than building from scratch. When a user asks "how is this different from X?", this file is the source of truth — extend it rather than improvising an answer.
