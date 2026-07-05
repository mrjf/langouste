import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Shared setup for service tests that exercise the real sqlite database.
 *
 * The app database is a process-wide singleton bound to LANGOUSTE_DATA_DIR on
 * first use (src/lib/db/index.ts), and config.ts reads process.env once at
 * module-eval time. So env and the data dir MUST be set before any test file
 * touches the DB, and exactly one dir must win for the whole process. This
 * module does that on first import: it picks one temp data dir, enables test
 * mode, and never deletes the dir mid-run. Import it (side-effect only) at the
 * very top of any DB-using test file, and give each test unique rows (unique
 * emails, generated ids) rather than resetting the database between tests.
 */
process.env.DATABASE_MODE = "sqlite";
process.env.ANTHROPIC_API_KEY ||= "test-key";
process.env.LANGOUSTE_JWT_SECRET ||= "test-secret";
process.env.LANGOUSTE_TEST_MODE ??= "true";
process.env.LANGOUSTE_STUB_AI ??= "true";
if (!process.env.LANGOUSTE_DATA_DIR) {
  process.env.LANGOUSTE_DATA_DIR = mkdtempSync(join(tmpdir(), "langouste-test-db-"));
}

export const TEST_DATA_DIR = process.env.LANGOUSTE_DATA_DIR;
