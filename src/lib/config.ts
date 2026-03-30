function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  port: parseInt(process.env.PORT ?? "8000", 10),
};
