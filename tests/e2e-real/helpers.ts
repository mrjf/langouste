import { test as base } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { connect } from "node:net";
import { TestApi } from "../e2e/helpers";

/**
 * Preflight check: fail loudly and skip if a precondition isn't met. Used
 * from `beforeEach`. Passes the Playwright test object so skip marks the
 * current test, not the whole file.
 *
 * Signature note: we accept a `SkipTest` shape so callers can pass either
 * the imported `test` (for describe-level skips) or `test.info()` (for
 * runtime skips inside beforeEach). Both expose `.skip(cond, msg)`.
 */
type SkipTest = { skip: (cond: boolean, msg?: string) => void };

export async function requireAnthropicKey(test: SkipTest): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  const missing = !key || !key.startsWith("sk-");
  if (missing) {
    test.skip(
      true,
      "🚨 ANTHROPIC_API_KEY not set in the parent env — skipping real Claude integration. Set it in .env or export it before running real tests.",
    );
  }
}

export async function requireOpenclawGateway(
  test: SkipTest,
  port = 18789,
): Promise<void> {
  const reachable = await tcpConnectable("127.0.0.1", port, 1000);
  if (!reachable) {
    test.skip(
      true,
      `🚨 OpenClaw gateway not listening on 127.0.0.1:${port} — skipping.\n\nStart it:\n   openclaw gateway --allow-unconfigured\n\nThe connector auto-pairs via Ed25519 device identity on first connect.`,
    );
    return;
  }

  // The gateway's EMBEDDED agent needs its own provider credentials to
  // answer turns. Detect up front rather than failing opaquely mid-turn.
  // NOTE: test.skip() throws a PlaywrightSkip exception that must propagate;
  // do not wrap the skip calls in try/catch.
  let authProfilesPath: string;
  let profilesJson: string | null = null;
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    authProfilesPath = join(homedir(), ".openclaw/agents/main/agent/auth-profiles.json");
    if (existsSync(authProfilesPath)) {
      profilesJson = readFileSync(authProfilesPath, "utf-8");
    }
  } catch (err) {
    console.warn(`[e2e-real] openclaw preflight config read failed: ${err}`);
    return;
  }

  if (!profilesJson) {
    test.skip(
      true,
      `🚨 OpenClaw main agent config missing. Run: openclaw agents add main`,
    );
    return;
  }

  let hasAnthropic = false;
  try {
    const profiles = JSON.parse(profilesJson) as {
      profiles?: Record<string, { provider?: string }>;
    };
    hasAnthropic = Object.values(profiles.profiles ?? {}).some(
      (p) => p.provider === "anthropic",
    );
  } catch {
    // malformed — treat as missing
  }

  if (!hasAnthropic) {
    test.skip(
      true,
      `🚨 OpenClaw's main agent has no Anthropic provider. Run: openclaw agents add main`,
    );
  }
}

/** Read OpenClaw's shared-secret token from its config file. */
export async function readOpenclawToken(): Promise<string | undefined> {
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(homedir(), ".openclaw/openclaw.json");
    if (!existsSync(path)) return undefined;
    const cfg = JSON.parse(readFileSync(path, "utf-8")) as {
      gateway?: { auth?: { token?: string } };
    };
    return cfg.gateway?.auth?.token?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function tcpConnectable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Send a message through the UI and wait for both the user's bubble and the
 * agent's reply to render. Returns when the thread is stable.
 *
 * Defaults to Shift+Enter (force-submit) so the real Opus check/explain
 * pipeline doesn't block test prompts that happen to be in a different
 * language from the user's target. Tests that specifically want the check
 * pipeline should pass `{ useCheckPipeline: true }` with a prompt in the
 * target language.
 */
export async function sendAndAwaitReply(
  page: Page,
  text: string,
  opts: { timeout?: number; expectAgentBubble?: boolean; useCheckPipeline?: boolean } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 90_000;

  // Record the bubble count BEFORE we send, so we can wait for +2 (user+agent)
  // rather than a fixed minimum — crucial for multi-turn tests.
  const bubblesBefore = await page.locator(".messages .message-bubble").count();

  const editable = page.locator(".editable[contenteditable='true']");
  await editable.click();
  await editable.fill(text);
  await page.keyboard.press(opts.useCheckPipeline ? "Enter" : "Shift+Enter");

  // Wait for user's bubble (bubblesBefore + 1).
  await page.waitForFunction(
    ({ count }) => document.querySelectorAll(".messages .message-bubble").length >= count,
    { count: bubblesBefore + 1 },
    { timeout: 30_000 },
  );

  if (opts.expectAgentBubble === false) return;

  // Wait for the agent bubble (bubblesBefore + 2).
  await page.waitForFunction(
    ({ count }) => document.querySelectorAll(".messages .message-bubble").length >= count,
    { count: bubblesBefore + 2 },
    { timeout },
  );
}

/** Create a connector via API using the default-single-user token. */
export async function createConnector(
  request: APIRequestContext,
  connector: { name: string; type: string; config: Record<string, unknown> },
): Promise<string> {
  const token = (await (await request.post("/api/auth/local")).json()).session.access_token;
  const res = await request.post("/api/agent-connectors", {
    headers: { Authorization: `Bearer ${token}` },
    data: connector,
  });
  if (!res.ok()) throw new Error(`create connector failed: ${res.status()} ${await res.text()}`);
  return (await res.json()).connector_id;
}

/** Open the new-chat dialog and click the connector whose name includes the given substring. */
export async function startChatWith(page: Page, connectorName: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByRole("button", { name: new RegExp(connectorName, "i") }).click();
  await page.waitForSelector(".thread-header", { timeout: 10_000 });
}

/**
 * Poll `predicate` every 500ms until it returns truthy or the timeout fires.
 * Throws if the timeout is reached.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

export { TestApi };
export const test = base;
