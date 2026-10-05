/** Reversible local preview: uses test-only memory storage and stubbed services. */
import { setupTestApp, teardownTestApp } from "../tests/e2e/harness.ts";
const app = await setupTestApp({ stubAi: true });
console.log(`Course preview: ${app.baseUrl}/#/course/hu`);
console.log(`Egyptian Arabic: ${app.baseUrl}/#/course/ar-EG`);
console.log("TEST DATA ONLY: progress is discarded when this process stops. Press Ctrl-C to stop.");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await teardownTestApp(app);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
