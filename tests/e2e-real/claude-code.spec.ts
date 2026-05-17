import { expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  test,
  TestApi,
  createConnector,
  requireAnthropicKey,
  sendAndAwaitReply,
  startChatWith,
} from "./helpers";

test.describe("Claude Code connector (real Agent SDK subprocess)", () => {
  let scratchCwd: string;

  test.beforeEach(async ({ request }) => {
    await requireAnthropicKey(test);
    await new TestApi(request).fullReset();
    scratchCwd = mkdtempSync(join(tmpdir(), "langouste-cc-cwd-"));
  });

  test.afterEach(async () => {
    if (scratchCwd) rmSync(scratchCwd, { recursive: true, force: true });
  });

  test("real Claude Code session returns a reply and persists it", async ({ page, request }) => {
    await createConnector(request, {
      name: "claude-code-real",
      type: "claude-code",
      // Pin to Haiku for cost and speed.
      config: { model: "claude-haiku-4-5-20251001", cwd: scratchCwd },
    });

    await startChatWith(page, "claude-code-real");
    // Short pure-chat prompt. SDK default disallows most destructive tools
    // when we don't pass a system prompt, and Haiku is quick.
    await sendAndAwaitReply(
      page,
      "Respond with exactly the four words: acknowledged and ready here",
      { timeout: 120_000 },
    );

    const api = new TestApi(request);
    const messages = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.find((m) => !m.is_agent)?.raw_text).toMatch(/acknowledged/);
    expect((messages.find((m) => !!m.is_agent)?.raw_text ?? "").length).toBeGreaterThan(0);
  });

  test("session history resumes across a second turn (same connector)", async ({
    page,
    request,
  }) => {
    await createConnector(request, {
      name: "claude-code-resume",
      type: "claude-code",
      config: { model: "claude-haiku-4-5-20251001", cwd: scratchCwd },
    });

    await startChatWith(page, "claude-code-resume");
    await sendAndAwaitReply(page, "Remember the number forty-two, nothing else.", {
      timeout: 120_000,
    });
    await sendAndAwaitReply(page, "What number did I ask you to remember?", {
      timeout: 120_000,
    });

    const api = new TestApi(request);
    const messages = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    // Four bubbles total.
    expect(messages.filter((m) => !!m.is_agent)).toHaveLength(2);
    // The second agent reply should mention 42 or "forty-two" — the SDK's
    // session_id resume gives it the memory.
    const secondAgentReply = messages.filter((m) => !!m.is_agent)[1].raw_text;
    expect(secondAgentReply.toLowerCase()).toMatch(/42|forty.?two/);
  });
});
