# Validation on gnat.local — 2026-10-04

- Host `gnat.local`; home `/Users/russ`; checkout `/Users/russ/projects/langouste`.
- Original authored course SHA-256 remains
  `3f011bdad8a339b4deca23e363e48d03f7afde4122599a0ff7a9e86860857b3f`.
- Catalog: original 60 lessons plus 2 daily supplements; all 1,080 original
  exercise identities retained. Supplements contribute 40 more exercises.
- Service regression suite: **168 pass, 0 fail**, 10,605 assertions (including browser-local grading).
- Svelte type check: **0 errors, 0 warnings**. Worker TypeScript check passes.
- Lint, Worker lint/format, and git whitespace checks pass.
- Existing Bun frontend and separate Pages frontend both build successfully.
- Worker deployment dry run only: 4,872.46 KiB uncompressed, 596.79 KiB gzip.
- Actual local workerd tests pass: public reads; private writes; no local-account
  bypass; same-origin POST enforcement; secure cookie flags; two disposable
  accounts; forged account header and tampered-token rejection; simultaneous
  retry deduplication; hinted recall receives no independent recall credit.
- Progress and the single assisted attempt survive stopping/restarting workerd.
- Actual Chrome: days 1/15/30 in Hungarian and Egyptian Arabic, desktop and
  390px mobile; no horizontal overflow; English/transliteration toggles; no answer
  audio before feedback; sign-in UI; saved practice step on reload; sign-out.
- Pages proxy: API binding forwards the original request, missing binding fails
  closed, and static requests reach Assets.
- Audio control test: 1.0 and 0.75 playback rates with pitch preservation, same
  cached asset, media mocked. No pronunciation quality or generated audio claimed.
- Screenshots: `/tmp/langouste-cloud-browser/` (six desktop and six mobile views).
- Audio inventory: hu 739 assets / 11,095 characters; ar-EG 744 / 9,306; total
  1,483 / 20,401. Read-only ElevenLabs subscription preflight returned HTTP 401, provider code `missing_permissions` (not an invalid-key response).

Tests used only a loopback turbopuffer-protocol fixture, disposable accounts and
local Durable Object storage. No real learner database writes, paid synthesis, backend deployment,
DNS changes, new production credentials, or Git push occurred. Existing untracked
`tmp/` content was preserved. Account-backend production CPU quotas, real-account sign-in,
voice quality and audio publication license remain unverified until
the relevant setup and approvals in README.md / AUDIO.md are resolved.

## Approved static launch

Published to https://langouste-course.pages.dev/ (deployment 5698c594). HTTPS 200
and the complete 62-lesson public catalog verified. No Worker/DO/API or credentials
were deployed. Eight-lesson Chrome checks cover days 1/15/30/31 in both languages,
no sign-in or account API requests, browser-local save/reload, fresh-browser
isolation, gloss/transliteration hiding and mobile layout. Screenshots are in
`/tmp/langouste-static-browser/`. Bare-domain migration awaits complete DreamHost
DNS inventory and Cloudflare zone setup, as described in README.md.

## Compact UI update

Deployment https://1121de17.langouste-course.pages.dev/ was the preceding production
version. Removed promotional branding/hero/cards, replaced the index with compact
day-sorted rows, reduced lesson typography/spacing, and reduced the storage notice
to one small factual line. Type check: zero errors/warnings; lint and publish
scan pass. Live Chrome checks pass all eight lesson cases plus compact desktop/
mobile index, correct day order and absent marketing copy. Screenshots:
`/tmp/langouste-static-browser/compact-hu-index-desktop.png`,
`/tmp/langouste-static-browser/compact-hu-index-mobile.png`, and
`/tmp/langouste-static-browser/ar-EG-1-mobile.png`. Existing browser progress
retains the same storage keys and structure.

DreamHost panel access was tried through the existing Chrome profile. The panel
opens Websites: List View. Scripted inspection is blocked by Chrome's existing
Apple Events JavaScript setting and disabled macOS UI accessibility; neither was
changed. The current supported Manage Websites URL is open on gnat for the user
to retrieve langouste.ai's DNS Settings inventory. Nameservers remain unchanged.


## Complete workbook redesign

- 169 service tests pass, zero failures, 10,613 assertions. Added legacy-history
  immutability and assistance-exclusion checks.
- Lint and original Bun app build pass; Svelte type check has zero errors/warnings.
- Static build contains 70 files / 5,679,526 bytes, zero configured secret matches,
  no Worker resources, and an explicitly allowlisted font plus redistribution license.
- Chrome workbook QA covers Hungarian and Egyptian Arabic days 1/15/30 and both
  supplements: sentence meanings, transliteration, RTL, reference focus, answer
  evidence, exact question resume, mobile overflow, separate language resume,
  review, reference search, backup export, fresh-browser isolation and no API calls.
- Additional Chrome QA covers matching pair feedback, sentence ordering/reset,
  self-grading, no automatic advance, support remaining recorded after hiding and
  reloading, passage resume, nested inspector focus and hash-preserving skip links.
- Original authored-course.json SHA256 remains
  `3f011bdad8a339b4deca23e363e48d03f7afde4122599a0ff7a9e86860857b3f`.
- Screenshots: `/tmp/langouste-workbook-browser/`. Tests use disposable contexts;
  no actual learner records, existing account or user profile storage are modified.
- Impeccable official checkout: `6e802bd0ed99f53180e2359fddab6da8d97970d9`.
  Published guidance applied. Context/detector engine could not be installed;
  no automated detector pass is claimed. Independent finish reviewer scored five
  requested fixes resolved: density, nested reference focus, label hierarchy,
  self-hosted typography and plain control labels. Its ship verdict covers those fixes.
- Content audit found supported recognition and both receptive/productive prompts;
  no retroactive learning evidence or claim of CEFR validation is introduced.
  Original content and existing account review scheduler remain unchanged.

Final production deployment: https://f90fb40d.langouste-course.pages.dev/
Stable URL: https://langouste-course.pages.dev/
Both Chrome suites passed against the live production URL after deployment.
Reference-page and beginner-note exposure now count conservatively as support.
The course was opened in Chrome on gnat.local; the temporary local server was stopped.
