# Plan 005: Replace the regex Wiktionary sanitizer feeding {@html} with an allowlist

> **Executor instructions**: Follow step by step; verify each step; on any STOP
> condition, stop and report. Update `plans/README.md` when done unless a
> reviewer owns the index.
>
> **Drift check (run first)**: `git diff --stat 0785e48..HEAD -- src/services/references/item-reference.ts src/client/components/ProfilePanel.svelte`
> On any change, compare "Current state" to live code; mismatch → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `0785e48`, 2026-07-02

## Why this matters

`ProfilePanel.svelte:951` renders `{@html referenceData.conjugation_html}` — raw
HTML injected into the DOM with no framework escaping. That HTML comes from
Wiktionary and is passed through a **hand-rolled regex sanitizer**,
`sanitizeWiktionaryHtml` (`src/services/references/item-reference.ts:266`).
Regex HTML sanitizers are a well-known losing game: the current one strips
`on…="…"` and `on…='…'` handlers but not unquoted handlers (`onclick=alert(1)`),
`javascript:` URLs, `<style>` with `expression`, `<iframe>`/`<object>`, SVG
event attributes, or malformed tags a browser will still parse. Wiktionary is
community-editable and fetched over the network, so a crafted or vandalized
conjugation table is a plausible stored-XSS vector into the user's session
(tokens live in `localStorage` — see `src/client/lib/auth.ts`). This plan
replaces the regex with an allowlist-based sanitizer so only known-safe tags and
attributes survive.

## Current state

- The sink (do not remove the feature, just make its input safe):
  ```svelte
  <!-- src/client/components/ProfilePanel.svelte:951 -->
  {@html referenceData.conjugation_html}
  ```
  `referenceData.conjugation_html` is typed `string | null`
  (`ProfilePanel.svelte:74`).

- The current sanitizer:
  ```ts
  // src/services/references/item-reference.ts:266-281
  function sanitizeWiktionaryHtml(html: string): string {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
      .replace(/<span class="mw-editsection"[\s\S]*?<\/span><\/span>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/href="\/wiki\//g, 'target="_blank" rel="noreferrer" href="https://en.wiktionary.org/wiki/')
      .replace(/href="\/w\//g, 'target="_blank" rel="noreferrer" href="https://en.wiktionary.org/w/')
      .replace(/src="\/\//g, 'src="https://')
      .replace(/\binflection-table-collapsed\b/g, "inflection-table-expanded")
      .slice(0, 140_000);
  }
  ```
  The URL-rewriting and class-flip transforms at the end are *feature* logic
  (make links absolute + open in new tab, expand collapsed tables) — those must
  be preserved. The `on…=` stripping is the *security* part that is
  insufficient.

- The repo already escapes-by-default for the *markdown* path
  (`src/client/lib/md.ts:154` escapes before rendering), but conjugation HTML
  intentionally keeps table markup, so escaping is not an option here — an
  allowlist sanitizer is required instead.

- **Dependency stance**: the repo keeps deps lean (`docs/ARCHITECTURE.md`,
  CLAUDE.md). Adding one **well-scoped, widely-audited** sanitizer is justified
  for a security boundary, but confirm the choice (see Step 1) — do not pull in
  a heavy DOM emulation stack casually.

## Commands you will need

| Purpose     | Command                                       | Expected     |
|-------------|-----------------------------------------------|--------------|
| Install dep | `bun add <chosen-sanitizer>`                  | exit 0       |
| Lint/format | `bun run check`                               | exit 0       |
| Unit tests  | `bun test tests/services`                     | all pass     |
| Typecheck   | `bun run typecheck`                            | 0 new errors |
| Build       | `bun run build`                               | exit 0       |

## Scope

**In scope**:
- `src/services/references/item-reference.ts` (replace `sanitizeWiktionaryHtml`)
- `tests/services/wiktionary-sanitizer.test.ts` (create)
- `package.json` / lockfile (only if adding the sanitizer dep)

**Out of scope**:
- Removing or changing the `{@html}` usage in `ProfilePanel.svelte` — the render
  stays; only its input is hardened. (You may add a one-line comment there
  pointing at the sanitizer, nothing more.)
- The other `{@html}` sites in `MessageBubble.svelte` / `MessageInput.svelte` —
  those go through `md()`/`renderMarkdown()` which escape first; out of scope
  here. (If you believe one is unsafe, report it separately.)
- The token-storage question (localStorage) — tracked as its own finding, not
  this plan.

## Git workflow

- Branch: `advisor/005-harden-html-sanitizer`
- Commit style: imperative, e.g. `security: allowlist-sanitize Wiktionary conjugation HTML`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Choose the sanitizer and confirm it runs in this context

`sanitizeWiktionaryHtml` runs **server-side** (in `src/services/`, a Bun
process), not in the browser. A browser-oriented sanitizer that needs a real
`window`/DOM will require a DOM shim. Pick one of:
- **`isomorphic-dompurify`** (DOMPurify + jsdom, works server-side without a
  manual shim) — heavier but purpose-built for exactly this.
- **`sanitize-html`** (allowlist-based, Node-native, no DOM emulation) — lighter,
  common for server-side sanitization.

Prefer **`sanitize-html`** unless a reason emerges to need DOMPurify's semantics;
it's lighter and Bun-friendly. Add it: `bun add sanitize-html` (+ its types if
needed: `bun add -d @types/sanitize-html`).

**Verify**: `bun add ...` → exit 0; `bun run typecheck` → the import resolves.

If neither installs/imports cleanly under Bun after a reasonable attempt, STOP
and report — do not hand-roll a bigger regex.

### Step 2: Rewrite `sanitizeWiktionaryHtml` as allowlist + feature transforms

Replace the body so that:
1. **Sanitize first** with an allowlist covering only what conjugation tables
   need: tags like `table, thead, tbody, tr, th, td, span, div, a, b, i, sup,
   sub, abbr, br, p, small` and attributes `class`, `title`, `colspan`,
   `rowspan`, `lang`, and on `a` only `href`/`target`/`rel`. Disallow all event
   handlers, `style`, `script`, `iframe`, `object`, `embed`, and `javascript:`
   URLs (restrict `a[href]` schemes to `http`/`https`/relative).
2. **Then apply the existing feature transforms** on the sanitized output:
   the `/wiki/` and `/w/` href absolutization (add `target="_blank" rel="noreferrer"`),
   `src="//"` → `src="https://"`, and the `inflection-table-collapsed` →
   `inflection-table-expanded` class flip. Keep the `.slice(0, 140_000)` length
   cap.
   - Note: apply URL absolutization in a way compatible with the sanitizer —
     e.g. configure the sanitizer's link handling, or post-process the
     sanitized string. Ensure the final `a` tags still carry
     `rel="noreferrer"` and `target="_blank"`.

Keep the function name and signature (`(html: string) => string`) so callers are
unchanged.

**Verify**: `bun run check` → exit 0; `bun run typecheck` → no new errors.

### Step 3: Add sanitizer tests

Create `tests/services/wiktionary-sanitizer.test.ts`. Export
`sanitizeWiktionaryHtml` (or a thin wrapper) for testing if it isn't already,
OR test via the public function that calls it (read `item-reference.ts` to see
what's exported; prefer testing the sanitizer directly — export it if needed).

Cases (assert the dangerous constructs are gone and the safe structure remains):
- A `<script>...</script>` is removed.
- An event handler on an element (quoted, unquoted, and mixed-case) is removed —
  the resulting string contains no `on`-handler attribute.
- A `javascript:` href is neutralized (not present as a live link scheme).
- An `<iframe>`/`<object>` is removed.
- A benign conjugation `<table>` with `<tr>/<td>` and a `/wiki/` link survives,
  and the link is absolutized to `https://en.wiktionary.org/wiki/...` with
  `rel="noreferrer"` and `target="_blank"`.
- The `inflection-table-collapsed` class is flipped to
  `inflection-table-expanded`.

Model structure on any existing `tests/services/*.test.ts` (e.g.
`vocabulary-normalizer.test.ts`).

**Verify**: `bun test tests/services/wiktionary-sanitizer.test.ts` → all pass.

### Step 4: Full suite, lint, build

**Verify**:
- `bun test tests/services` → all pass.
- `bun run check` → exit 0.
- `bun run build` → exit 0 (confirms the new dep doesn't break the client build
  path; the sanitizer is server-side but the build must still succeed).

## Test plan

New file `tests/services/wiktionary-sanitizer.test.ts` (pattern: existing
service unit tests) with the cases in Step 3 — dangerous tags/attributes/URLs
removed, safe table structure + feature transforms preserved.

## Done criteria

- [ ] `bun run check` exits 0
- [ ] `bun run typecheck` → no new errors
- [ ] `bun test tests/services` exits 0, includes the sanitizer test (≥ 6 cases)
- [ ] `bun run build` exits 0
- [ ] `grep -n "replace(/\\\\s+on\\[a-z\\]" src/services/references/item-reference.ts` returns nothing (the fragile regex handler-strip is gone)
- [ ] The feature transforms (`en.wiktionary.org/wiki/`, `inflection-table-expanded`) still appear in the function
- [ ] `{@html referenceData.conjugation_html}` still present in `ProfilePanel.svelte` (feature intact)
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report if:

- The chosen sanitizer can't run under Bun after a reasonable attempt.
- `sanitizeWiktionaryHtml` doesn't match the "Current state" excerpt (drifted —
  maybe already replaced).
- Removing the regex breaks a table's expected rendering in a way the allowlist
  can't express without re-allowing something dangerous — report the specific
  tag/attribute in tension.

## Maintenance notes

- If more Wiktionary structures need to render later (e.g. audio players),
  extend the **allowlist** explicitly — never re-add raw passthrough.
- A defense-in-depth follow-up (separate plan): move auth tokens off
  `localStorage` (httpOnly cookie or in-memory) so an XSS, if one ever lands,
  can't read the session. Referenced but not done here.
- Reviewer should confirm the allowlist denies `style`, all `on*` handlers, and
  non-http(s) URL schemes, and that links still open safely
  (`rel="noreferrer"`).
