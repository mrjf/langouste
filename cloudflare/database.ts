import { createTurbopufferDatabaseSet } from "../src/lib/db/turbopuffer-core.ts";
import type { Env } from "./worker.ts";
export function database(env: Env) {
  if (
    !env.TURBOPUFFER_API_KEY ||
    !env.TURBOPUFFER_REGION ||
    !env.TURBOPUFFER_NAMESPACE_PREFIX ||
    !env.LANGOUSTE_JWT_SECRET
  )
    throw Error("Unconfigured");
  return createTurbopufferDatabaseSet({
    compression: false,
    maxRetries: 0,
    apiKey: env.TURBOPUFFER_API_KEY,
    region: env.TURBOPUFFER_REGION,
    namespacePrefix: env.TURBOPUFFER_NAMESPACE_PREFIX,
  }).admin;
}
