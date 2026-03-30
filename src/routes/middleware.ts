import type { Context, Next } from "hono";
import { supabaseForUser } from "../lib/supabase-client.ts";

/**
 * Middleware that extracts the Supabase JWT from the Authorization header
 * and creates a per-request Supabase client.
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const supabase = supabaseForUser(token);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("supabase", supabase);
  c.set("userId", user.id);
  await next();
}
