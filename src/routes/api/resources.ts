import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import type { Database } from "../../lib/db/index.ts";

type ResourcesRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

const RESOURCE_CATALOG_URL = new URL(
  "../../../docs/free-language-learning-resources.json",
  import.meta.url,
);

let catalogPromise: Promise<unknown> | null = null;

function loadCatalog(): Promise<unknown> {
  catalogPromise ??= Bun.file(RESOURCE_CATALOG_URL).json();
  return catalogPromise;
}

export const resourcesRoutes = new Hono<ResourcesRouteBindings>();

resourcesRoutes.use("*", requireAuth);

resourcesRoutes.get("/", async (c) => {
  return c.json(await loadCatalog());
});
