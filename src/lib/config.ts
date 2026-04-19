function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requiredIf(mode: string, currentMode: string, name: string): string {
  if (mode !== currentMode) return "";
  return required(name);
}

const databaseMode = (process.env.DATABASE_MODE ?? "supabase") as "supabase" | "sqlite";
if (databaseMode !== "supabase" && databaseMode !== "sqlite") {
  throw new Error(`DATABASE_MODE must be 'supabase' or 'sqlite', got: ${databaseMode}`);
}

export const config = {
  databaseMode,

  // Supabase credentials only required when running in supabase mode.
  supabaseUrl: requiredIf("supabase", databaseMode, "SUPABASE_URL"),
  supabasePublishableKey: requiredIf(
    "supabase",
    databaseMode,
    "SUPABASE_PUBLISHABLE_KEY",
  ),
  supabaseSecretKey: requiredIf("supabase", databaseMode, "SUPABASE_SECRET_KEY"),

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  translationProvider: process.env.TRANSLATION_PROVIDER ?? "claude",

  // Local auth JWT secret (sqlite mode). Required only when DATABASE_MODE=sqlite.
  jwtSecret: requiredIf("sqlite", databaseMode, "LANGOUSTE_JWT_SECRET"),

  // Single-user mode: skip signup/login entirely and auto-issue a session for
  // a fixed local user. Default is on when running sqlite, off in supabase.
  // Override explicitly via LANGOUSTE_SINGLE_USER=true|false.
  singleUser: (() => {
    const raw = process.env.LANGOUSTE_SINGLE_USER?.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return databaseMode === "sqlite";
  })(),

  // Test mode: enables /api/test/* routes, the `stub` agent type, and canned
  // responses from LLM-backed services so integration tests don't call real
  // Anthropic / Google APIs. Must NOT be set in production.
  testMode: process.env.LANGOUSTE_TEST_MODE === "true",

  port: parseInt(process.env.PORT ?? "8000", 10),
};
