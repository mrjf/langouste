import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Correction flow", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("hint panel shows unresolved → resolved as user fixes the error", async ({
    page,
    request,
  }) => {
    const api = new TestApi(request);
    // Stub the error explainer: for input "quel est le but de cette projet",
    // flag "cette" → "ce" and return a matching corrected_message.
    await api.setExplainResponse("quel est le but de cette projet", {
      corrected_message: "quel est le but de ce projet",
      explanations: [],
      additional_errors: [
        {
          start: 17,
          end: 22,
          text: "cette",
          corrected: "ce",
          kind: "grammar",
          explanations: { en: "Use masculine 'ce' with masculine 'projet'." },
        },
      ],
    });
    await api.setDefaultAgentReply("noted");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();

    // Type the wrong version and press Enter.
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("quel est le but de cette projet");
    await page.keyboard.press("Enter");

    // Hint panel appears with 1 of 1 errors remaining.
    await expect(page.locator(".hint-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".hint-panel")).toContainText("1 of 1");
    // The hint item is unresolved (no ✓).
    const hintItem = page.locator(".hint-item").first();
    await expect(hintItem).not.toHaveClass(/resolved/);

    // Edit "cette" → "ce". We clear the word and retype.
    await editable.click();
    // Select all and retype the full corrected message.
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("quel est le but de ce projet");

    // The hint item is now resolved.
    await expect(hintItem).toHaveClass(/resolved/, { timeout: 5_000 });
    await expect(page.locator(".hint-panel")).toContainText(/All 1 error/);
  });

  test("Shift+Enter force-submits with errors present", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultExplainResponse({
      corrected_message: "a corrected version",
      explanations: [],
      additional_errors: [
        {
          start: 0,
          end: 5,
          text: "wrong",
          corrected: "right",
          kind: "grammar",
          explanations: { en: "Change it." },
        },
      ],
    });
    await api.setDefaultAgentReply("received");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("wrong text");
    // Shift+Enter bypasses the check pipeline.
    await page.keyboard.press("Shift+Enter");

    // User message lands in the thread as-is.
    await expect(page.locator(".messages").getByText("wrong text")).toBeVisible({
      timeout: 10_000,
    });
    // Agent reply arrives.
    await expect(page.locator(".messages").getByText("received")).toBeVisible({
      timeout: 15_000,
    });
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
