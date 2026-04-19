import { expect } from "@playwright/test";
import {
  test,
  TestApi,
  createConnector,
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
    await createConnector(request, {
      name: "openclaw-real",
      type: "openclaw",
      config: { url: "ws://127.0.0.1:18789", device_name: "langouste-test" },
    });

    await startChatWith(page, "openclaw-real");
    // Short, cheap prompt. We don't care exactly what OpenClaw says back,
    // only that a bubble arrives and state persists.
    await sendAndAwaitReply(page, "Say hi in exactly three words.");

    // Persistence.
    const api = new TestApi(request);
    const messages = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const user = messages.find((m) => !m.is_agent);
    const agent = messages.find((m) => !!m.is_agent);
    expect(user?.raw_text).toBe("Say hi in exactly three words.");
    expect(agent?.raw_text).toBeTruthy();
    expect((agent?.raw_text ?? "").length).toBeGreaterThan(0);
  });

  test("history survives reload", async ({ page, request }) => {
    await createConnector(request, {
      name: "openclaw-reload",
      type: "openclaw",
      config: { url: "ws://127.0.0.1:18789" },
    });
    await startChatWith(page, "openclaw-reload");
    await sendAndAwaitReply(page, "one line please");

    await page.reload();
    await page.locator(".conv-item").first().click();
    await expect(page.locator(".messages .message-bubble")).toHaveCount(2);
  });
});
