import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Message history persistence", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("messages persist across page reload", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("got it");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();

    for (const msg of ["one", "two", "three"]) {
      await sendMessage(page, msg);
    }

    // Wait for all 3 agent replies.
    await expect(page.locator(".messages .message-bubble")).toHaveCount(6, { timeout: 20_000 });

    await page.reload();
    // After reload, the same 6 messages are rendered. Conversation reselect
    // happens via URL hash — the sidebar shows the conversation; we click it.
    await page.locator(".conv-item").first().click();
    await expect(page.locator(".messages .message-bubble")).toHaveCount(6);
    await expect(page.locator(".messages").getByText("one")).toBeVisible();
    await expect(page.locator(".messages").getByText("three")).toBeVisible();
  });

  test("review_log captures production events", async ({ page, request }) => {
    const api = new TestApi(request);
    // Make the vocab extractor return a single new vocabulary item so
    // tracker.ts records a production event.
    await api.setDefaultVocabResponse({
      new_vocabulary: [
        { term: "chat", translation: "cat", context_sentence: "le chat", cefr_level: "A1" },
      ],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await api.setDefaultAgentReply("ok");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "bonjour le chat");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });

    // Give the async vocab pipeline a beat to land.
    await page.waitForTimeout(500);

    const logs = (await api.dbTable("review_log")) as Array<{
      event_type: string;
      outcome: string | null;
      source: string;
    }>;
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.event_type === "production" && l.outcome === "correct")).toBe(true);

    const vocab = (await api.dbTable("vocabulary")) as Array<{ term: string; productions: number }>;
    expect(vocab).toHaveLength(1);
    expect(vocab[0].term).toBe("chat");
    expect(vocab[0].productions).toBe(1);
  });
});

// --- helpers ---

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
  // Wait for user's bubble to render before continuing; the agent reply
  // arrives after, and the caller decides whether to await it.
  await expect(page.locator(".messages").getByText(text, { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
}
