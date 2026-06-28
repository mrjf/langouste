# Privacy

Langouste is designed for self-hosted and local-first use. This document describes the default project behavior; deployments can change behavior by changing providers, hosting, logging, or analytics.

## Local SQLite Mode

In `DATABASE_MODE=sqlite`, Langouste stores application data in a local SQLite database on the machine running the app. By default, that includes conversations, messages, translations, corrections, vocabulary, grammar gaps, review history, and local auth state.

Langouste does not include product analytics by default.

## Supabase Mode

In `DATABASE_MODE=supabase`, application data is stored in the configured Supabase project. Access control is enforced through Supabase Auth, Postgres, Realtime, and row-level security policies.

If you use a managed Supabase project, your data handling is also subject to Supabase's terms, configuration, and infrastructure.

## External Providers

Langouste sends data to external providers when configured features require it:

- Anthropic: chat replies, error explanations, translation through Claude, and vocabulary extraction.
- Google Cloud Translation: translations when `TRANSLATION_PROVIDER=google-tllm`.
- ElevenLabs: text-to-speech when `AUDIO_PROVIDER=elevenlabs`.
- Agent connectors: messages sent to configured Claude, OpenClaw, or HTTP endpoints.

Provider requests may include message text, translations, corrections, or metadata needed for the feature. Review each provider's data policy before using it with sensitive content.

## Secrets

Do not commit `.env`, API keys, Supabase secret keys, service-account JSON, private keys, generated databases, or local data directories. The repository tracks `.env.example` only.

## Logs

Development logs may include request paths, errors, and provider failures. Avoid running production deployments with verbose logs if messages or provider payloads may be printed by local debugging changes.

## Data Export And Deletion

SQLite mode data can be backed up or deleted by copying or removing the configured data directory. Supabase mode data should be exported or deleted from the configured Supabase project. Dedicated in-app export and delete commands are roadmap items, not stable public interfaces yet.
