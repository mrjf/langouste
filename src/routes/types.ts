import type { Database } from "../lib/db/index.ts";

export type AuthenticatedRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};
