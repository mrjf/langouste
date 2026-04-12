import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getProfile, updateProfile } from "../../services/database/profiles.ts";

export const profileRoutes = new Hono();

profileRoutes.use("*", requireAuth);

profileRoutes.get("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");

  const profile = await getProfile(supabase, userId);
  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }
  return c.json(profile);
});

profileRoutes.patch("/", async (c) => {
  const supabase = c.get("supabase");
  const userId = c.get("userId");
  const updates = await c.req.json();

  const profile = await updateProfile(supabase, userId, updates);
  return c.json(profile);
});
