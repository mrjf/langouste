import { config } from "../config.ts";
import {
  createTurbopufferDatabaseSet as createSet,
  namespaceName as name,
} from "./turbopuffer-core.ts";
import { TurbopufferDatabase as CoreDatabase } from "./turbopuffer-core.ts";
import type { Turbopuffer } from "@turbopuffer/turbopuffer";
export class TurbopufferDatabase extends CoreDatabase {
  constructor(client: Turbopuffer) {
    super(client, config.turbopufferNamespacePrefix, config.testMode);
  }
}
export function createTurbopufferDatabaseSet() {
  return createSet({
    apiKey: config.turbopufferApiKey,
    region: config.turbopufferRegion,
    namespacePrefix: config.turbopufferNamespacePrefix,
    baseURL: config.turbopufferBaseUrl,
    testMode: config.testMode,
  });
}
export function namespaceName(table: string) {
  return name(table, config.turbopufferNamespacePrefix);
}
