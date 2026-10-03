# Privacy

Langouste stores application data in the configured turbopuffer region. This
includes conversations, messages, Filo annotation documents, translations,
corrections, vocabulary, grammar gaps, review history, audio assets, and auth
state. turbopuffer durably commits successful writes to object storage.

Langouste owns application authentication and authorization; turbopuffer does
not provide row-level security for Langouste users. API keys remain on the
server. Langouste does not include product analytics by default.

## External Providers

Langouste sends data to external providers when configured features require it:

- Anthropic: chat replies, error explanations, translation through Claude, and vocabulary extraction.
- Google Cloud Translation: translations when `TRANSLATION_PROVIDER=google-tllm`.
- ElevenLabs: text-to-speech when `AUDIO_PROVIDER=elevenlabs`.
- Agent connectors: messages sent to configured Claude, OpenClaw, or HTTP endpoints.

Provider requests may include message text, translations, corrections, or metadata needed for the feature. Review each provider's data policy before using it with sensitive content.

## Secrets

Do not commit `.env`, API keys, service-account JSON, private keys, or exported datasets. The repository tracks `.env.example` only.

## Logs

Development logs may include request paths, errors, and provider failures. Avoid running production deployments with verbose logs if messages or provider payloads may be printed by local debugging changes.

## Data Export And Deletion

Use turbopuffer's namespace tools for backup/export/deletion. The legacy
importer is intentionally copy-only. Dedicated in-app export and account
deletion commands are roadmap items, not stable public interfaces yet.
