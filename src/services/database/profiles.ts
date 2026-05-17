import type { Database } from "../../lib/db/index.ts";
import type { Profile } from "../../types/index.ts";

export async function getProfile(db: Database, userId: string): Promise<Profile | null> {
  return db.selectOne<Profile>("profiles", {
    filters: [{ op: "eq", column: "user_id", value: userId }],
  });
}

export async function createProfile(
  db: Database,
  profile: Pick<Profile, "user_id" | "display_name" | "base_language" | "learning_languages">,
): Promise<Profile> {
  return db.insert<Profile>("profiles", profile);
}

export async function updateProfile(
  db: Database,
  userId: string,
  updates: Partial<Pick<Profile, "display_name" | "base_language" | "learning_languages">>,
): Promise<Profile> {
  return db.updateOne<Profile>("profiles", { ...updates, updated_at: new Date().toISOString() }, [
    { op: "eq", column: "user_id", value: userId },
  ]);
}
