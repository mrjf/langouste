import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../../types/index.ts";

export async function getProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw error;
  }
  return data;
}

export async function createProfile(
  supabase: SupabaseClient,
  profile: Pick<
    Profile,
    "user_id" | "display_name" | "base_language" | "learning_languages"
  >,
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .insert(profile)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<
    Pick<Profile, "display_name" | "base_language" | "learning_languages">
  >,
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
