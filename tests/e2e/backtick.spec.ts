import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Backtick literal convention", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("backticked word is preserved in the translator stub", async ({ page, request }) => {
    const api = new TestApi(request);
    // The translator stub returns a deterministic string by default; we
    // verify what the stub received is what the app sent — end-to-end — by
    // inspecting the persisted translations on the message row.
    await api.setDefaultAgentReply("ok");
    await api.setTranslation("hello `Biscuit`", "en", "hello `Biscuit`");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "hello `Biscuit`");

    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });

    // Check the stored message translations round-tripped through the stub.
    const rows = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      translations: string;
      is_agent: number;
    }>;
    const user = rows.find((r) => !r.is_agent);
    expect(user?.raw_text).toBe("hello `Biscuit`");
  });

  test("stubbed explain response ignores backticked span", async ({ page, request }) => {
    const api = new TestApi(request);
    // Tell the explainer to report zero errors — matching how it should
    // behave when the only "suspect" token is inside backticks.
    await api.setExplainResponse("my cat is `Biscuit`", {
      corrected_message: "my cat is `Biscuit`",
      explanations: [],
      additional_errors: [],
    });
    await api.setDefaultAgentReply("nice name");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: /stub/i }).click();

    await sendMessage(page, "my cat is `Biscuit`");
    // No hint panel should appear — message sends directly.
    await expect(page.locator(".messages").getByText("nice name")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".hint-panel")).toHaveCount(0);
  });
});

async function seedConnector(request: APIRequestContext, name: string): Promise<string> {
  const token = (await (await request.post("/api/auth/local")).json()).session.access_token;
  const res = await request.post("/api/agent-connectors", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, type: "stub", config: {} },
  });
  return (await res.json()).connector_id;
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const editable = page.locator(".editable[contenteditable='true']");
  await editable.click();
  // Use fill to avoid keyboard layout-dependent backtick handling.
  await editable.fill(text);
  await page.keyboard.press("Enter");
}
