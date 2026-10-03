import type { Context, Next } from "hono";
import { adminDb } from "../lib/db/index.ts";
import { validateToken } from "../lib/auth/local.ts";
import type { AuthenticatedRouteBindings } from "./types.ts";

/**
 * Validates the Authorization bearer token and binds a per-request Database
 * plus the authenticated user ID into the Hono context.
 *
 * turbopuffer does not provide application-user authentication or RLS.
 * Langouste validates its own JWT and routes apply explicit ownership and
 * conversation-membership filters before reading data.
 */
export async function requireAuth(c: Context<AuthenticatedRouteBindings>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);

  const result = await validateToken(token);
  if (!result) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  c.set("db", adminDb());
  c.set("userId", result.userId);
  return next();
}
