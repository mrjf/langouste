# Live static Langouste course

Live: https://langouste-course.pages.dev/
Deployment: https://f90fb40d.langouste-course.pages.dev/

Initial launch is public, has no sign-in, and saves learning progress only in the
current browser/device. It does not sync between devices or to an existing account.
Clearing site data removes it. Progress is isolated under the localStorage prefix
`langouste-course-local:v1:`; the app does not touch existing account/session data.
Web Locks serialize simultaneous local writes. Attempts, hints, reveals, matching
results and self-grading survive reload. Prepared content is not learning evidence.

There are 62 lessons: the original 60 plus the two 2026-10-04 supplements. The
static assets contain grading answers, as expected for a browser-graded public
course; the UI hides answer-bearing feedback/audio until an attempt or reveal.
This is a practice tool, not a secure exam. There are no Worker/API/DO/database
resources or server secrets in this deployment. Existing learner databases remain
untouched. The future account-synced implementation remains in the checkout;
[ACCOUNT-SYNC.md](ACCOUNT-SYNC.md) records its separate design and prior tests.

## Reproduce

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build:static
bun run check:static-publish
bun tests/cloudflare/workbook-browser.ts https://langouste-course.pages.dev
bun tests/cloudflare/workbook-practice-browser.ts https://langouste-course.pages.dev
```

The publish check allowlists asset paths, rejects Worker files and oversized assets,
and checks against existing configured secret values without printing them. The
verified upload contained 70 files / 5,679,526 bytes and zero secret matches.

To publish an approved update using the existing Cloudflare login:

```sh
bun run build:static
bun run check:static-publish
CLOUDFLARE_ACCOUNT_ID=8ce2cffc47b8b76a6f1d67997bf196bf wrangler pages deploy dist/pages --project-name langouste-course --branch main
```

Pages requires the default `wrangler.jsonc` filename and does not accept an
`account_id` field. The explicit environment setting selects the approved account
`cf@bagaduce.com`. The Pages project was created with production branch `main`.
No Git push is involved. Wrangler 4.101.0 and compatibility date 2026-06-23 were
used. No paid plan, upgrade, new terms acceptance or billing changes were made.

## Reading workbook

The public client now uses a persistent lesson index, a central reading/practice
workspace and a contextual reference inspector. Exact authored terms and supplied
forms open reference without inferring morphology. Mobile uses a language selector,
lesson drawer and closeable reference sheet. Sentence meanings are progressively
revealed; Egyptian transliteration is separate. Read, Notice a pattern, Practise
and Reread are freely selectable. Feedback retains the learner response and does
not auto-advance. Review lists latest incorrect answers across lessons; Reference
searches stable authored vocabulary IDs. Neither is a new spaced-review scheduler.

Existing `langouste-course-local:v1:` records and earlier attempts remain unchanged.
New version-two attempts add support snapshots, direction and a content fingerprint.
Hints, reveals, transliteration, supplied support and reference use exclude first
unassisted-response credit. Completion remains participation, not mastery or lasting
retention. New resume metadata preserves separate language, passage and question
positions. Settings exports a full JSON backup; import is not implemented.

Source Serif 4 is self-hosted with its OFL license at
`/licenses/source-serif4-OFL.txt`. No external font service, fake audio control,
browser-generated speech, sign-in or account API is introduced. PRODUCT.md and
DESIGN.md document the learning and visual boundaries.

## Bare langouste.ai domain handoff

The user selected the bare domain and authorized moving DNS to Cloudflare. Current
public registrar data identifies DreamHost, LLC (IANA 431), nameservers
ns1/ns2/ns3.dreamhost.com, and DNSSEC unsigned. Cloudflare zone lookup in the approved
account returned no langouste.ai zone. The current OAuth grant includes zone read,
not zone write. A full AXFR inventory request to DreamHost was refused. Public
lookups of known names cannot prove that all mail, TXT/verification, service and
subdomain records have been found; do not replace nameservers using that partial
view.

The existing Chrome profile has a DreamHost session that opens **Websites: List
View**. Its normal [Manage Websites page](https://panel.dreamhost.com/index.cgi?tree=domain.dashboard)
is open on gnat. Programmatic page inspection is blocked: Chrome JavaScript from
Apple Events is off and macOS UI accessibility reports disabled. Neither setting
was changed. No cookies, saved passwords or additional credential locations were
inspected. The next actionable step is to use that open panel to select langouste.ai
and obtain its DNS Settings record list/export. If the panel requests sign-in,
the user should enter credentials there, never in chat.

Supported handoff (no registrar transfer or purchase is needed):

1. Sign in personally at DreamHost. Open **Manage Websites → langouste.ai menu →
   DNS Settings**. Obtain the complete DNS record inventory, including records
   DreamHost manages automatically. Preserve mail/MX, SPF, DKIM, DMARC, TXT
   verification, SRV, CAA and all subdomains. Do not send account passwords.
2. In the existing Cloudflare account, add langouste.ai on the **Free** DNS plan.
   Review/import the full DreamHost inventory; an automatic DNS scan alone is
   insufficient. Any new terms/security prompts require the user's action.
3. Associate **langouste.ai** with the existing **langouste-course** Pages project.
   Review the resulting apex record and all preserved records before activation.
4. Only after that review, use DreamHost's **DNS Settings → Nameservers** section
   (or **Manage Registrations → DNS**) to enter the exact nameservers assigned to
   that new Cloudflare zone. Their values do not exist in this task yet; do not guess.
   Do not change DNSSEC/security settings as part of this handoff without approval.
5. Verify authoritative DNS, HTTPS, mail-related records and the bare-domain course.

Progress saved on pages.dev will remain scoped to that browser origin and will
not automatically appear at langouste.ai after the switch. Settings provides a JSON backup export. Import is not implemented; do not promise
automatic cross-origin progress transfer.

Cloudflare's current documentation supports SQLite Durable Objects on Workers
Free. Account subscription lookup returned 403/10000, so the actual Workers plan
could not be verified. This does not block the static launch: no Durable Objects
or Worker are used or provisioned.

Sources:
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://help.dreamhost.com/hc/en-us/articles/360035516812-Adding-custom-DNS-records
- https://help.dreamhost.com/hc/en-us/articles/360038897151-Changing-your-nameservers-at-DreamHost
