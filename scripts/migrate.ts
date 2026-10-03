#!/usr/bin/env bun
/**
 * turbopuffer namespaces are schematized lazily on their first batch write,
 * so there are no DDL migrations to apply. This command validates credentials
 * and reports the current Langouste namespace inventory.
 */

import { Turbopuffer } from "@turbopuffer/turbopuffer";

if (process.env.LANGOUSTE_TEST_MODE === "true" && process.env.LANGOUSTE_TEST_STORAGE === "memory") {
  console.log("OK — in-memory test transport requires no migrations.");
  process.exit(0);
}

const apiKey = required("TURBOPUFFER_API_KEY");
const region = process.env.TURBOPUFFER_REGION ?? "aws-us-west-2";
const prefix = process.env.TURBOPUFFER_NAMESPACE_PREFIX ?? "langouste";
const client = new Turbopuffer({
  apiKey,
  region,
  baseURL: process.env.TURBOPUFFER_BASE_URL || undefined,
});

let count = 0;
for await (const namespace of client.namespaces({ prefix })) {
  console.log(`  ${namespace.id}`);
  count++;
}
console.log(
  count === 0
    ? `OK — connected to ${region}; namespaces will be created on first write.`
    : `OK — connected to ${region}; found ${count} ${prefix} namespace(s).`,
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
