import { teardownTestApp } from "./harness.ts";
import type { TestAppHandle } from "./harness.ts";

declare global {
  // eslint-disable-next-line no-var
  var __LANGOUSTE_APP__: TestAppHandle | undefined;
}

export default async function globalTeardown() {
  const handle = globalThis.__LANGOUSTE_APP__;
  if (handle) {
    globalThis.__LANGOUSTE_APP__ = undefined;
    await teardownTestApp(handle);
  }
}
