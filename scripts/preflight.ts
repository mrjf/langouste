/**
 * Fail before any long-lived process starts when required configuration is
 * missing. This is intentionally separate from src/main.ts: Bun's watch mode
 * remains alive after an import-time exception, which can otherwise leave the
 * Vite frontend running against a dead backend.
 */

try {
  const { config } = await import("../src/lib/config.ts");
  const storage = config.testStorage === "memory" ? "in-memory test storage" : "turbopuffer";
  console.log(`[preflight] Configuration valid (${storage}).`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error("");
  console.error("============================================================");
  console.error(" LANGOUSTE STARTUP FAILED: INVALID CONFIGURATION");
  console.error("============================================================");
  console.error(` ${message}`);
  console.error("");
  console.error(" Set the required values in .env (see .env.example).");
  if (message.includes("TURBOPUFFER_API_KEY")) {
    console.error(" Get a turbopuffer key at https://turbopuffer.com/dashboard");
  }
  console.error("");

  process.exit(1);
}
