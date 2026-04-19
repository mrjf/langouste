import { defineConfig } from "@playwright/test";
import { setupTestApp, teardownTestApp, type TestAppHandle } from "./tests/e2e/harness";

/**
 * Real-integration Playwright config.
 *
 * Runs tests under tests/e2e-real/ against a backend configured to call real
 * external services (Anthropic API, Claude Code SDK, OpenClaw gateway). The
 * /api/test DB-reset routes stay available so each test gets a clean slate,
 * but the AI service stubs are OFF — every LLM call hits the wire.
 *
 * Preconditions (specs preflight-check and skip if missing):
 *   - ANTHROPIC_API_KEY in the parent env for claude + claude-code specs.
 *   - openclaw gateway running at ws://127.0.0.1:18789 for the openclaw spec.
 *
 * Budget: each spec sends a few real turns. Cost per full run is a few
 * cents with Haiku; higher if you swap in Opus or use Claude Code heavily.
 */

declare global {
  // eslint-disable-next-line no-var
  var __LANGOUSTE_APP_REAL__: TestAppHandle | undefined;
}

const handle = await setupTestApp({ stubAi: false });
globalThis.__LANGOUSTE_APP_REAL__ = handle;
process.env.LANGOUSTE_E2E_BASE_URL = handle.baseUrl;
console.log(`[e2e-real] app ready at ${handle.baseUrl} (data: ${handle.dataDir})`);

const cleanup = async () => {
  if (globalThis.__LANGOUSTE_APP_REAL__) {
    const h = globalThis.__LANGOUSTE_APP_REAL__;
    globalThis.__LANGOUSTE_APP_REAL__ = undefined;
    await teardownTestApp(h);
  }
};
process.on("exit", () => {
  if (globalThis.__LANGOUSTE_APP_REAL__) {
    globalThis.__LANGOUSTE_APP_REAL__.backend.kill();
  }
});
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

export default defineConfig({
  testDir: "./tests/e2e-real",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./tests/e2e-real/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Real agent turns can take 20+ seconds (Claude Code especially).
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: handle.baseUrl,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
