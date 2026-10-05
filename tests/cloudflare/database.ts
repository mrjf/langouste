import { createTurbopufferDatabaseSet } from "../../src/lib/db/turbopuffer-core.ts";
export function database() {
  return createTurbopufferDatabaseSet({
    compression: false,
    maxRetries: 0,
    apiKey: "isolated-test-only",
    region: "test",
    namespacePrefix: "cloud-qa",
    baseURL: "http://127.0.0.1:8790",
    testMode: true,
  }).admin;
}
