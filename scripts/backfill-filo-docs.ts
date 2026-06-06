/**
 * Backfill message.filo_doc for existing corpus rows.
 *
 * Usage:
 *   bun scripts/backfill-filo-docs.ts
 *   bun scripts/backfill-filo-docs.ts --base-only
 *
 * Default mode builds full Filo docs with word, translation, and dictionary
 * tiers. --base-only skips dictionary lookups and only stores word and
 * translation tiers.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "../src/types/index.ts";

loadDotenv();

const [{ adminDb, db: databaseSet }, filoDocs] = await Promise.all([
  import("../src/lib/db/index.ts"),
  import("../src/services/corpus/filo-docs.ts"),
]);

const baseOnly = process.argv.includes("--base-only");
const database = adminDb();
const messages = await database.select<Message>("messages", {
  order: [{ column: "created_at", ascending: true }],
});
const pending = messages.filter((message) => !message.filo_doc);

console.log(
  `Backfilling ${pending.length} of ${messages.length} message Filo docs` +
    (baseOnly ? " (base tiers only)" : " (full dictionary tiers)"),
);

let completed = 0;
for (const message of pending) {
  if (baseOnly) {
    await filoDocs.persistBaseMessageFiloDoc(database, message);
  } else {
    await filoDocs.enrichAndPersistMessageFiloDoc(database, message);
  }
  completed += 1;
  if (completed % 25 === 0) console.log(`  ${completed}/${pending.length}`);
}

await databaseSet().close();
console.log(`OK — backfilled ${completed} message Filo docs.`);

function loadDotenv(): void {
  const envPath = resolve(import.meta.dir, "../.env");
  if (!existsSync(envPath)) return;
  const envText = readFileSync(envPath, "utf-8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}
