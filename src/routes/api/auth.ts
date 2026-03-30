import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../lib/config.ts";

export const authRoutes = new Hono();

authRoutes.post("/signup", async (c) => {
  const { email, password, display_name, base_language, learning_languages } =
    await c.req.json();

  const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) {
    return c.json({ error: authError.message }, 400);
  }

  const userId = authData.user?.id;
  if (!userId) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  // Create profile
  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: userId,
    display_name,
    base_language,
    learning_languages: learning_languages ?? [],
  });

  if (profileError) {
    return c.json({ error: profileError.message }, 500);
  }

  return c.json({
    user: authData.user,
    session: authData.session,
  });
});

authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return c.json({ error: error.message }, 401);
  }

  return c.json({
    user: data.user,
    session: data.session,
  });
});
