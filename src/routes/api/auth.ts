import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../lib/config.ts";
import { adminDb } from "../../lib/db/index.ts";
import * as localAuth from "../../lib/auth/local.ts";

export const authRoutes = new Hono();

// Single-user mode (default for sqlite): issue a session for the local user
// with no credentials. The client calls this on mount instead of showing a
// login form. Disabled in supabase mode and when LANGOUSTE_SINGLE_USER=false.
authRoutes.post("/local", async (c) => {
  if (!config.singleUser || config.databaseMode !== "sqlite") {
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
  const { email, password, display_name, base_language, learning_languages } =
    await c.req.json();

  if (config.databaseMode === "sqlite") {
    try {
      const session = await localAuth.signup(email, password);
      // Create the profile row alongside. Pure local — no RLS to worry about.
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
  }

  // Supabase path
  const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });
  if (authError) return c.json({ error: authError.message }, 400);

  const userId = authData.user?.id;
  if (!userId) return c.json({ error: "Failed to create user" }, 500);

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: userId,
    display_name,
    base_language,
    learning_languages: learning_languages ?? [],
  });
  if (profileError) return c.json({ error: profileError.message }, 500);

  return c.json({ user: authData.user, session: authData.session });
});

authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  if (config.databaseMode === "sqlite") {
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
  }

  // Supabase path
  const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return c.json({ error: error.message }, 401);

  return c.json({ user: data.user, session: data.session });
});
