# turbopuffer storage

Langouste has one durable storage and search engine: turbopuffer. Logical
tables are isolated into namespaced document collections, and Filo documents
are also projected into a dedicated full-text corpus index.

## Configuration

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `TURBOPUFFER_API_KEY` | yes | — | Server-side turbopuffer API key |
| `TURBOPUFFER_REGION` | no | `aws-us-west-2` | Data and query region |
| `TURBOPUFFER_NAMESPACE_PREFIX` | no | `langouste` | Environment/tenant namespace isolation |
| `TURBOPUFFER_BASE_URL` | no | SDK default | BYOC, proxy, or test endpoint |
| `LANGOUSTE_JWT_SECRET` | yes | — | Signs application-owned auth tokens |

`bun run migrate` validates the connection and lists matching namespaces.
Namespaces and schemas are created lazily on the first batch write.

## Object storage and source documents

turbopuffer uses object storage as its durable source of truth. A successful
write is committed to that object storage, so normal deployments do not need
to create or operate an S3 bucket for database rows.

In turbopuffer Cloud, turbopuffer operates that storage. A BYOC deployment is
different: its control-plane setup provisions/configures object storage in
your cloud account (S3, Google Cloud Storage, or Azure Blob Storage).

Complete Filo JSON documents are stored inline in `corpus_documents` and
projected into searchable `title`, `text`, and `annotation_text` attributes.
Langouste chunks the JSON payload so no single attribute exceeds
turbopuffer's 8 MiB attribute limit, and caps the combined payload below the
64 MiB document limit. Objects larger than that need an external blob store;
store their URI and searchable metadata in turbopuffer.

Audio-drill generation may use a local directory while ffmpeg and the lesson
builder are running. That directory is a disposable cache: completed lesson
and source Filo documents are indexed in `corpus_documents`, drill metadata is
stored in `audio_drills`, and final/source/clip bytes are stored as individual
`audio_assets` rows.

## Namespace layout

With prefix `langouste-prod`, examples include:

- `langouste-prod-messages`
- `langouste-prod-vocabulary`
- `langouste-prod-review-log`
- `langouste-prod-reading-interactions`
- `langouste-prod-audio-drills`
- `langouste-prod-corpus-documents`

Different schemas use different namespaces. Scalar attributes needed by
filters and ordering are materialized; the complete logical row is preserved
as chunked JSON. Filo corpus rows enable BM25 on source and annotation text.
The integrated News tab stores complete editions in `corpus_documents` with
`source_type=reading`; exact word, sentence, audio, vocabulary, and Workbench
actions are stored under the same owner in `reading_interactions`. Its local
JSON cache is rebuildable and never replaces the learner-owned corpus row.

## Importing legacy data

Imports are non-destructive and batch writes:

```sh
bun run import:turbopuffer --sqlite /path/to/langouste.db
```

or:

```sh
LEGACY_SUPABASE_URL=https://project.supabase.co \
LEGACY_SUPABASE_SECRET_KEY=... \
bun run import:turbopuffer --supabase
```

The importer copies logical rows, hydrates legacy JSON columns, builds corpus
search rows for Filo documents, and verifies a readable sample in every
written namespace. It never deletes the source database.

Legacy filesystem drill corpora can be imported separately or alongside a
database import:

```sh
bun run import:turbopuffer \
  --audio-drills-root ./data/audio-drills \
  --owner-id <destination-user-id>
```

## Authentication and isolation

turbopuffer is not the application's identity provider and does not supply
row-level security. Langouste owns password hashing and JWT validation.
Routes and services must continue to enforce user ownership and conversation
membership explicitly. API keys must remain server-side.

Tests use `LANGOUSTE_TEST_MODE=true` plus
`LANGOUSTE_TEST_STORAGE=memory`, an ephemeral contract test double that cannot
be enabled in production.
