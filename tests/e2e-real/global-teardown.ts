import { teardownTestApp } from "../e2e/harness.ts";
import type { TestAppHandle } from "../e2e/harness.ts";

declare global {
  // eslint-disable-next-line no-var
  var __LANGOUSTE_APP_REAL__: TestAppHandle | undefined;
}

export default async function globalTeardown() {
  const handle = globalThis.__LANGOUSTE_APP_REAL__;
  if (handle) {
    globalThis.__LANGOUSTE_APP_REAL__ = undefined;
    await teardownTestApp(handle);
  }
}
