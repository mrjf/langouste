# GitHub-triggered course publication

Pushes to `main` and the active release branch
`codex/compact-course-transliteration` run `.github/workflows/publish-course.yml`.
The workflow checks types and course behavior, restores a checksum-pinned audio
release asset, builds all 64 lessons, validates the static output, and publishes
to the existing `langouste-course` production branch `main`.

Audio remains outside Git history. `.github/course-audio.json` pins the release
asset, its SHA-256, and coverage. Updating that file in a commit adopts a new
verified recording snapshot. There are no synthesis calls in CI.

One repository Actions secret is required: `CLOUDFLARE_API_TOKEN`, scoped to
Account → Cloudflare Pages → Edit for cf@bagaduce.com's account. The workflow
only receives it in the deployment steps. No DNS, zone, billing, or account-wide
administrator permission is requested. The account ID is a public identifier.
No credential is committed. Creation or transfer of this access needs explicit
user approval; the workflow fails clearly until it is configured.

Cloudflare does not convert Direct Upload projects to native Git integration.
The supported CI upload path preserves the existing project and custom domain:
https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
https://developers.cloudflare.com/pages/get-started/direct-upload/
