import { expect } from "@playwright/test";
import {
  test,
  TestApi,
  createConnector,
  readOpenclawToken,
  requireOpenclawGateway,
  sendAndAwaitReply,
  startChatWith,
} from "./helpers";

test.describe("OpenClaw connector (real gateway)", () => {
  test.beforeEach(async ({ request }) => {
    await requireOpenclawGateway(test);
    await new TestApi(request).fullReset();
  });

  test("send a message and get a real reply from the gateway", async ({ page, request }) => {
    const token = await readOpenclawToken();
    await createConnector(request, {
      name: "openclaw-real",
      type: "openclaw",
      config: {
        url: "ws://127.0.0.1:18789",
        device_name: "langouste-test",
        ...(token ? { token } : {}),
      },
    });

    await startChatWith(page, "openclaw-real");
    // OpenClaw's embedded agent answers via whatever provider it's configured
    // for. We don't assert exact content — just that a non-empty reply comes back.
    await sendAndAwaitReply(page, "Say hi in exactly three words.", { timeout: 120_000 });

    const api = new TestApi(request);
    const messages = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const user = messages.find((m) => !m.is_agent);
    const agent = messages.find((m) => !!m.is_agent);
    expect(user?.raw_text).toBe("Say hi in exactly three words.");
    expect((agent?.raw_text ?? "").length).toBeGreaterThan(0);
  });

  test("history survives reload and second turn reuses the session", async ({ page, request }) => {
    const token = await readOpenclawToken();
    await createConnector(request, {
      name: "openclaw-reload",
      type: "openclaw",
      config: {
        url: "ws://127.0.0.1:18789",
        ...(token ? { token } : {}),
      },
    });

    await startChatWith(page, "openclaw-reload");
    await sendAndAwaitReply(page, "Respond with exactly the single word: acknowledged", {
      timeout: 120_000,
    });

    await page.reload();
    await page.locator(".conv-item").first().click();
    await expect(page.locator(".messages .message-bubble")).toHaveCount(2);

    // Second turn on the same connector — the connector reuses its persisted
    // device identity so no re-pairing happens.
    await sendAndAwaitReply(page, "Reply with the single word: confirmed", {
      timeout: 120_000,
    });
    await expect(page.locator(".messages .message-bubble")).toHaveCount(4);
  });
});
