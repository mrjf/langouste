import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getProfile, updateProfile } from "../../services/database/profiles.ts";
import type { AuthenticatedRouteBindings } from "../types.ts";

export const profileRoutes = new Hono<AuthenticatedRouteBindings>();

profileRoutes.use("*", requireAuth);

profileRoutes.get("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const profile = await getProfile(db, userId);
  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }
  return c.json(profile);
});

profileRoutes.patch("/", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const updates = await c.req.json();

  const profile = await updateProfile(db, userId, updates);
  return c.json(profile);
});
