import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Profile dashboard", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("dashboard tiles reflect real usage counts", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("got it");
    // Stub vocab extraction: one item per message.
    await api.setDefaultVocabResponse({
      new_vocabulary: [
        { term: "salut", translation: "hi", context_sentence: "Salut", cefr_level: "A1" },
      ],
      grammar_gaps_detected: [
        { category: "verb:agreement", description: "Subject-verb mismatch" },
      ],
      next_challenge: "",
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "Salut test");

    // Wait for the agent reply so the async vocab pipeline has had a moment.
    await expect(page.locator(".messages").getByText("got it")).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(500);

    // Navigate to profile.
    await page.getByRole("button", { name: /Your progress/ }).click();
    await expect(page.getByRole("heading", { name: "Your progress" })).toBeVisible();

    // Messages sent tile is 1 (we sent one).
    const tiles = page.locator(".tile");
    await expect(tiles.filter({ hasText: "Messages sent" }).locator(".tile-value")).toHaveText("1");
    await expect(tiles.filter({ hasText: "Vocabulary items" }).locator(".tile-value")).toHaveText("1");
    await expect(tiles.filter({ hasText: "Grammar concepts" }).locator(".tile-value")).toHaveText("1");
  });

  test("lexis drill-down lists vocabulary items; clicking opens item view", async ({
    page,
    request,
  }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ok");
    await api.setDefaultVocabResponse({
      new_vocabulary: [
        { term: "manger", translation: "to eat", context_sentence: "je mange", cefr_level: "A1" },
      ],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "je mange");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /Your progress/ }).click();
    // Click the Lexis dimension card.
    await page.getByRole("button", { name: /Lexis/ }).click();
    // Item shows up in the table.
    await expect(page.getByRole("cell", { name: "manger" })).toBeVisible();
    await page.getByRole("cell", { name: "manger" }).click();
    // Item detail panel shows linked message.
    await expect(page.locator(".item-hero")).toContainText("manger");
    // The linked-messages section has a button per message.
    await expect(page.locator(".msg-link .msg-text").filter({ hasText: "je mange" })).toBeVisible();
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
