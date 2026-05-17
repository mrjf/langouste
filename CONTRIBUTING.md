# Contributing

## Quality gates

CI runs on every push to `main` and every PR targeting `main`
(`.github/workflows/ci.yml`). Run the same checks locally before pushing:

```sh
bun run check      # Biome: lint + format (BLOCKING in CI)
bun run test       # unit tests — tests/services (BLOCKING in CI)
bun run build      # frontend production build (BLOCKING in CI)
bun run typecheck  # svelte-check (NON-BLOCKING — see below)
```

Convenience scripts:

```sh
bun run lint        # lint only
bun run lint:fix    # auto-fix lint + format issues
bun run format      # format-write only
bun run format:check
```

### Linting / formatting — Biome

[Biome](https://biomejs.dev) handles both linting and formatting for
`.ts` files in `src/`, `tests/`, `scripts/` (config: `biome.json`).
Style matches the existing codebase: double quotes, semicolons,
2-space indent, 100-col width, trailing commas. Svelte components are
type-checked by `svelte-check` and compiled by `vite build` rather
than linted by Biome (Biome does not fully parse `.svelte`).

`bun run check` must be clean — it is a blocking CI gate.

### Type checking — svelte-check (non-blocking)

`bun run typecheck` runs `svelte-check` against `tsconfig.check.json`
(a CI-only config with DOM libs + bundler resolution; the root
`tsconfig.json` is tuned for Bun's runtime resolver and is left
untouched).

This job is **non-blocking** in CI (`continue-on-error: true`)
because the codebase has a pre-existing backlog of type errors,
concentrated in legacy components (e.g. `ConnectionsPanel.svelte`
uses Svelte 4-style `$state` as a store). The job still surfaces new
type regressions in PR checks. Once the backlog is cleared, flip
`continue-on-error` to `false` in `.github/workflows/ci.yml` to make
it blocking.

### Tests

`bun run test` runs `bun test tests/services` (unit tests only).
Playwright suites (`tests/e2e`, `tests/e2e-real`) are **not** run in
CI: the real-integration specs need live agent endpoints and API
keys. Run them locally with `bun run test:e2e` /
`bun run test:e2e:real`.
