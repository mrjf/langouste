# Retained account-synced version (not deployed)

Target domain: **langouste.ai**. The local checkout is on gnat.local at
`/Users/russ/projects/langouste`. This build contains the original 60 lessons and
two separately imported 2026-10-04 supplements. It does not contain learner data,
server environment files, API keys, password hashes, or a credential-free login.

## Architecture and account boundary

`bun run build:cloudflare` validates and resolves the catalog at build time. Pages
serves the Svelte course shell and cached audio. Its small `_worker.js` forwards
only `/api/*` through the `COURSE_API` service binding. The separate Worker exposes
public lesson reads and authenticated account practice. Each request parses only
the selected lesson. Neither account signup nor the Bun app's local single-user
login is exposed; `local@langouste` is explicitly rejected.

Existing bcrypt accounts sign in over HTTPS. A host-only Secure/HttpOnly,
SameSite=Strict cookie lasts 24 hours. POSTs require the same Origin. Login has a
five-attempt, fifteen-minute per-account limit. Account IDs come from verified
JWTs, never request bodies or client headers. One SQLite Durable Object per user
serializes course/FSRS writes across Worker isolates. Existing turbopuffer remains
the authoritative learning store; Durable Object storage holds login rate counters,
not a replacement learner database. Course receipt IDs protect retries and leave
uncertain downstream updates marked for reconciliation rather than replaying them.

The adapter now materializes `lesson_id` and `progress_id`. Owner-scoped reads also
recover older rows without those projections, so no destructive migration is
needed. Do not run the old Bun writer concurrently for the same account: it does
not participate in the Cloudflare coordinator. Coordinating those separate writers
would require an additional integration. Real account selection remains unverified;
no real learner writes were used for QA.

## Reproduce checks (no deployment)

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:cloudflare
bun run typecheck:cloudflare
wrangler deploy --dry-run --config wrangler.course.jsonc --outdir /tmp/langouste-worker-build
```

The checked-in runtime compatibility date is 2026-06-23, supported by Wrangler
4.101.0 used for verification. The Worker dry-run bundle is approximately 0.6 MiB
gzipped. Current Free limits include 100,000 Worker requests/day, 10 ms Worker CPU
per request, 20,000 Pages files, and 25 MiB per asset. Bcrypt and serialized writes
run in Durable Objects rather than consuming the edge Worker's short CPU budget.
SQLite Durable Objects are available on Free with separate request/duration/storage
quotas. Local timings are not production CPU measurements: verify actual CPU and
usage after any approved staging deployment. Free allowances are limits, not a
promise of unlimited hosting. Existing turbopuffer/ElevenLabs costs are separate.

Isolated end-to-end verification, in separate terminals:

```sh
bun tests/cloudflare/mock-turbopuffer.ts /tmp/langouste-cloud-mock.json
wrangler dev --config tests/cloudflare/wrangler.jsonc --local --persist-to /tmp/langouste-cloud-runtime
bun tests/cloudflare/verify.ts
bun tests/cloudflare/browser.ts
bun tests/cloudflare/audio-controls.ts
```

The test-only alias replaces the database factory with a loopback protocol fixture;
it cannot reach the production turbopuffer endpoint. Accounts use example.invalid
addresses and disposable passwords. The fixture file and runtime directory retain
test state for restart checks; use fresh paths for a clean run. Browser QA requires
installed Google Chrome. Repeated login tests may hit the deliberate rate limit.
Media playback is mocked only in `audio-controls.ts`; it does not claim voice quality.
Never deploy the test Wrangler configuration.

## Proposed publication steps — require separate approval

Deployment account reviewed: `cf@bagaduce.com`, Cloudflare account
`8ce2cffc47b8b76a6f1d67997bf196bf`. Wrangler's existing OAuth session has Worker
and Pages write access; no new Cloudflare token is needed for the proposed deploy.
Resources are exactly one Pages project, one Worker, its `ACCOUNTS` SQLite Durable
Object namespace/migration, and the Pages `COURSE_API` binding. No R2, D1, KV,
new learner database, paid-plan upgrade, or scheduled service is proposed.

The user can either sign in with an existing password-enabled Langouste account,
or separately authorize establishing/recovering such an account through their
normal account workflow. This narrow hosted app has no signup/reset route. Do not
list stored accounts or reuse the credential-free local identity. Passwords are
entered into the login form; no learning-account credentials belong in deployment
configuration. ElevenLabs credentials remain local to the prerecorded asset build.

1. Confirm the intended existing account and exact turbopuffer namespace; do not
   equate the single-user local account with the user's synced identity.
2. Approve transmitting the existing server secret configuration to the named
   Cloudflare Worker: `TURBOPUFFER_API_KEY`, `LANGOUSTE_JWT_SECRET`, plus region and
   namespace settings. Enter secrets through Wrangler's protected secret input;
   never put them in source, command arguments, Pages assets, logs, or chat.
3. Create/deploy Worker `langouste-course-api` with `wrangler.course.jsonc`, then
   Pages project `langouste-course` with `wrangler.pages.jsonc`. The Worker has
   workers.dev and preview URLs disabled; Pages reaches it through its binding.
   Review Pages preview access before uploading production secrets or content.
4. Test HTTPS sign-in, account isolation, durability, and quotas on the actual
   Pages URL returned by Cloudflare. No project or live URL has been created yet.
5. DNS choices:
   - Keep DNS unchanged initially and verify the actual Pages URL.
   - Keep DreamHost nameservers: associate `www.langouste.ai` with Pages first,
     then add `www CNAME <actual-project>.pages.dev` at DreamHost. **Yes, www can
     avoid nameserver migration.** An apex-to-www redirect would be a separate
     DreamHost/web forwarding configuration, not something a CNAME alone provides.
   - Use the bare `langouste.ai` Pages apex: approve migrating the zone's nameservers
     to Cloudflare after a complete record inventory and DNSSEC review.
   Inventory all DreamHost DNS records before changing the domain. At review time,
   langouste.ai used ns1/ns2/ns3.dreamhost.com. Pages apex custom domains require a
   Cloudflare zone/nameserver change; a subdomain can use a CNAME without moving
   all DNS. Nameserver, DNSSEC, security, and domain changes need their own review.

This account backend has not been deployed. The initial public launch instead uses static Pages with browser-local progress; see README.md. No production secret upload, DNS change, Git push, purchase, or persistent service installation occurred.

References:
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/pages/functions/bindings/#service-bindings
