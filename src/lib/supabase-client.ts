import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";

// Server-side client with secret key (bypasses RLS for admin operations)
export const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseSecretKey,
);

// Create a per-request client using the user's JWT (respects RLS)
export function supabaseForUser(accessToken: string) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
