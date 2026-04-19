import { test as base } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { connect } from "node:net";
import { TestApi } from "../e2e/helpers";

/**
 * Preflight check: fail loudly and skip if a precondition isn't met.
 * We *don't* want "test passes because it was skipped" to be invisible, so
 * the message is noisy.
 */
export async function requireAnthropicKey(test: { skip: (cond: boolean, msg: string) => void }): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  const missing = !key || !key.startsWith("sk-");
  test.skip(
    missing,
    "🚨 ANTHROPIC_API_KEY not set in the parent env — skipping real Claude integration. Set it in .env or export it before running real tests.",
  );
}

export async function requireOpenclawGateway(
  test: { skip: (cond: boolean, msg: string) => void },
  port = 18789,
): Promise<void> {
  const reachable = await tcpConnectable("127.0.0.1", port, 1000);
  test.skip(
    !reachable,
    `🚨 OpenClaw gateway not listening on 127.0.0.1:${port} — skipping real OpenClaw integration.

For integration tests, start the gateway WITHOUT auth:

   openclaw gateway --auth none --allow-unconfigured

(The Langouste OpenClaw connector does not yet implement token-auth
challenge-response handshakes — see the tracking issue if this isn't yet
supported. Running with --auth none exposes the gateway on loopback only,
which is safe for local testing.)`,
  );
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
