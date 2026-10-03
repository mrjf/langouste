import { defineConfig } from "@playwright/test";
import { setupTestApp, teardownTestApp, type TestAppHandle } from "./tests/e2e/harness";

/**
 * Langouste e2e config.
 *
 * All tests run against a freshly-spawned backend with an isolated in-memory
 * turbopuffer contract transport. LANGOUSTE_TEST_MODE=true activates the stub agent and
 * canned-response LLM services so no real APIs are called.
 *
 * Lifecycle: playwright.config.ts runs once per test run, before any test
 * fires. We set the app up here, stash the handle on globalThis, and use
 * globalTeardown to tear it down after the whole suite completes.
 */

declare global {
  // eslint-disable-next-line no-var
  var __LANGOUSTE_APP__: TestAppHandle | undefined;
}

const handle = await setupTestApp();
globalThis.__LANGOUSTE_APP__ = handle;
process.env.LANGOUSTE_E2E_BASE_URL = handle.baseUrl;
console.log(`[e2e] app ready at ${handle.baseUrl} (data: ${handle.dataDir})`);

// Make sure we clean up even if something dies mid-run.
const cleanup = async () => {
  if (globalThis.__LANGOUSTE_APP__) {
    const h = globalThis.__LANGOUSTE_APP__;
    globalThis.__LANGOUSTE_APP__ = undefined;
    await teardownTestApp(h);
  }
};
process.on("exit", () => {
  if (globalThis.__LANGOUSTE_APP__) {
    // Sync best-effort on hard exit.
    globalThis.__LANGOUSTE_APP__.backend.kill();
  }
});
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
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
