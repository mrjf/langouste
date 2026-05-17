import type { Context, Next } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "../lib/config.ts";
import { adminDb, userDb } from "../lib/db/index.ts";
import { validateToken } from "../lib/auth/local.ts";

/**
 * Validates the Authorization bearer token and binds a per-request Database
 * plus the authenticated user ID into the Hono context.
 *
 * - supabase mode: token is a Supabase JWT; validate via Supabase Auth, hand
 *   back a per-user Database (RLS respected).
 * - sqlite mode: token is a locally-issued JWT (see lib/auth/local.ts);
 *   validate with hono/jwt and hand back the admin Database (no RLS in
 *   SQLite).
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);

  if (config.databaseMode === "supabase") {
    const authClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser();
    if (error || !user) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    c.set("db", userDb(token));
    c.set("userId", user.id);
    return next();
  }

  // sqlite mode
  const result = await validateToken(token);
  if (!result) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  c.set("db", adminDb());
  c.set("userId", result.userId);
  return next();
}
