import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Orphaned conversations", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("deleting a connection orphans its chat; reattach resumes sending", async ({
    page,
    request,
  }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ack");
    const aId = await seedConnector(request, "conn-a");
    const bId = await seedConnector(request, "conn-b");
    void bId;

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    // Click the first (conn-a).
    await page.getByRole("button", { name: /conn-a/ }).click();
    await sendMessage(page, "first");
    await expect(page.locator(".messages").getByText("ack")).toBeVisible({ timeout: 15_000 });

    // Delete conn-a via API.
    const token = (await (await request.post("/api/auth/local")).json()).session.access_token;
    const delRes = await request.delete(`/api/agent-connectors/${aId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok()).toBe(true);

    // Refresh conversations — the easy way is reload.
    await page.reload();
    await page.locator(".conv-item").first().click();

    // Orphan banner shows and the header flags the state.
    await expect(page.locator(".orphan-banner")).toBeVisible();
    await expect(page.locator(".partner-name")).toContainText("No connection");

    // Pick conn-b in the banner's dropdown and attach. The options include
    // `conn-b (stub)` (with the type in parens) — match by substring.
    const dropdown = page.locator(".orphan-banner select");
    const optionLabel = await dropdown
      .locator("option")
      .filter({ hasText: "conn-b" })
      .first()
      .textContent();
    await dropdown.selectOption({ label: optionLabel ?? "" });
    await page.getByRole("button", { name: /Attach/ }).click();

    // Banner goes away, header reverts.
    await expect(page.locator(".orphan-banner")).toHaveCount(0);
    await expect(page.locator(".partner-name")).toContainText("conn-b");

    // Sending a new message works.
    await sendMessage(page, "second");
    await expect(page.locator(".messages").getByText("second")).toBeVisible();
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
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
