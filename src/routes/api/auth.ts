import { Hono } from "hono";
import { config } from "../../lib/config.ts";
import { adminDb } from "../../lib/db/index.ts";
import * as localAuth from "../../lib/auth/local.ts";

export const authRoutes = new Hono();

// Single-user mode: issue a session for the local user
// with no credentials. The client calls this on mount instead of showing a
// login form. Disabled when LANGOUSTE_SINGLE_USER=false.
authRoutes.post("/local", async (c) => {
  if (!config.singleUser) {
    return c.json({ error: "Single-user mode is not enabled" }, 404);
  }
  const session = await localAuth.ensureLocalSession();
  return c.json({
    user: { id: session.user.id, email: session.user.email },
    session: {
      access_token: session.access_token,
      expires_at: session.expires_at,
    },
  });
});

authRoutes.post("/signup", async (c) => {
  const { email, password, display_name, base_language, learning_languages } = await c.req.json();

  try {
    const session = await localAuth.signup(email, password);
    await adminDb().insert("profiles", {
      user_id: session.user.id,
      display_name,
      base_language,
      learning_languages: learning_languages ?? [],
    });
    return c.json({
      user: { id: session.user.id, email: session.user.email },
      session: {
        access_token: session.access_token,
        expires_at: session.expires_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signup failed";
    return c.json({ error: msg }, 400);
  }
});

authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  try {
    const session = await localAuth.login(email, password);
    return c.json({
      user: { id: session.user.id, email: session.user.email },
      session: {
        access_token: session.access_token,
        expires_at: session.expires_at,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    return c.json({ error: msg }, 401);
  }
});
