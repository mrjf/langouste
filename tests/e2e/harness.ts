import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Spin up a completely isolated Langouste backend for integration tests.
 *
 * - Creates a fresh data directory under /tmp, so the SQLite file is
 *   disposable and tests don't share state with your dev instance.
 * - Runs bun scripts/migrate.ts against that data dir.
 * - Spawns `bun src/main.ts` with LANGOUSTE_TEST_MODE=true, a random port,
 *   and all the knobs test mode needs.
 * - Polls /health until the server responds, then returns.
 *
 * The returned handle carries teardown data; call teardown() from
 * globalTeardown.
 */

export interface TestAppHandle {
  port: number;
  baseUrl: string;
  dataDir: string;
  backend: ChildProcess;
}

export interface TestAppOptions {
  /**
   * Intercept AI service calls with canned responses. Default `true` —
   * stub-only integration tests never hit real APIs. Set to `false` for
   * tests under tests/e2e-real/ that exercise real connectors and real
   * LLM services end-to-end.
   */
  stubAi?: boolean;
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

export async function setupTestApp(options: TestAppOptions = {}): Promise<TestAppHandle> {
  const stubAi = options.stubAi ?? true;

  // Real-integration mode needs credentials. Load from .env into
  // process.env (without overwriting anything that's already set).
  if (!stubAi) loadDotEnvIntoProcess();

  // Tests hit the production bundle served by the backend. Build it if it
  // doesn't exist — subsequent test runs skip this.
  await ensureClientBuild();

  const dataDir = mkdtempSync(join(tmpdir(), "langouste-e2e-"));
  const port = await pickFreePort();

  // When stubbing, we don't need a real Anthropic key; drop in a placeholder
  // so misconfigured local envs can't accidentally exfiltrate credentials.
  // When NOT stubbing (real-integration tests), pass the real key through
  // verbatim — callers must have it set in their parent env.
  const anthropicKey = stubAi
    ? "sk-test-placeholder-never-used"
    : (process.env.ANTHROPIC_API_KEY ?? "");

  const env: Record<string, string> = {
    ...process.env,
    DATABASE_MODE: "sqlite",
    LANGOUSTE_DATA_DIR: dataDir,
    LANGOUSTE_JWT_SECRET: "test-jwt-secret-do-not-use-in-production",
    LANGOUSTE_SINGLE_USER: "true",
    LANGOUSTE_TEST_MODE: "true",
    LANGOUSTE_STUB_AI: stubAi ? "true" : "false",
    ANTHROPIC_API_KEY: anthropicKey,
    PORT: String(port),
    TRANSLATION_PROVIDER: "claude",
  };

  // Google creds are bleed-in risks; only pass them through when AI is
  // stubbed (where they'll never be called) OR when the caller explicitly
  // wants the google-tllm path. For real tests against Claude translator
  // (the default), scrub them.
  if (stubAi || env.TRANSLATION_PROVIDER === "claude") {
    env.GOOGLE_APPLICATION_CREDENTIALS = "";
    env.GOOGLE_CLOUD_PROJECT = "";
  }

  // 1. Run migrations.
  const migrateResult = await runOnce(["bun", "scripts/migrate.ts"], env);
  if (migrateResult.code !== 0) {
    throw new Error(
      `Migration failed (exit ${migrateResult.code}):\nstdout: ${migrateResult.stdout}\nstderr: ${migrateResult.stderr}`,
    );
  }

  // 2. Spawn backend. Serves API + pre-built client on the same port.
  const backend = spawn("bun", ["src/main.ts"], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipePrefixed(backend.stdout, "[backend]");
  pipePrefixed(backend.stderr, "[backend!]");

  const baseUrl = `http://localhost:${port}`;
  try {
    await waitForHealth(baseUrl, 20_000);
  } catch (err) {
    backend.kill();
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }

  return { port, baseUrl, dataDir, backend };
}

export async function teardownTestApp(handle: TestAppHandle): Promise<void> {
  if (!handle.backend.killed) {
    handle.backend.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (handle.backend.exitCode !== null) return resolve();
      handle.backend.once("exit", () => resolve());
      setTimeout(() => resolve(), 5000);
    });
  }
  rmSync(handle.dataDir, { recursive: true, force: true });
}

function loadDotEnvIntoProcess(): void {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function ensureClientBuild(): Promise<void> {
  const indexPath = resolve(PROJECT_ROOT, "dist/client/index.html");
  if (existsSync(indexPath)) return;

  console.log("[harness] Building client bundle (first run)...");
  const result = await runOnce(["bun", "run", "build"], {
    ...process.env,
    VITE_DATABASE_MODE: "sqlite",
    VITE_SINGLE_USER: "true",
  });
  if (result.code !== 0) {
    throw new Error(`Client build failed: ${result.stderr.slice(0, 2000)}`);
  }
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(150);
  }
  throw new Error(
    `Server at ${baseUrl} did not become healthy within ${timeoutMs}ms; last error: ${lastErr}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolvePort(port));
      } else {
        reject(new Error("could not pick a free port"));
      }
    });
  });
}

function pipePrefixed(stream: NodeJS.ReadableStream | null, prefix: string): void {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line) process.stderr.write(`${prefix} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer) process.stderr.write(`${prefix} ${buffer}\n`);
  });
}

interface RunResult { code: number; stdout: string; stderr: string; }

function runOnce(cmd: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const p = spawn(cmd[0], cmd.slice(1), {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => { stdout += d; });
    p.stderr?.on("data", (d) => { stderr += d; });
    p.on("exit", (code) => resolveRun({ code: code ?? 0, stdout, stderr }));
    p.on("error", (err) => resolveRun({ code: 1, stdout, stderr: String(err) }));
  });
}
