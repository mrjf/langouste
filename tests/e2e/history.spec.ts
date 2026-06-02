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

  test("agent target-language text records seen vocabulary without production credit", async ({
    page,
    request,
  }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("good morning");
    await api.setTranslation("good morning", "fr", "bonjour");
    await api.setVocabResponse("bonjour", {
      new_vocabulary: [
        { term: "bonjour", translation: "hello", context_sentence: "bonjour", cefr_level: "A1" },
      ],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "salut");
    await expect(page.locator(".messages").getByText("bonjour")).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => {
        const vocab = (await api.dbTable("vocabulary")) as Array<{
          term: string;
          encounters: number;
          productions: number;
        }>;
        return vocab.find((v) => v.term === "bonjour") ?? null;
      })
      .toMatchObject({ term: "bonjour", encounters: 1, productions: 0 });

    const logs = (await api.dbTable("review_log")) as Array<{
      event_type: string;
      outcome: string | null;
      source: string;
      message_id: string | null;
    }>;
    expect(
      logs.some(
        (log) =>
          log.event_type === "encounter" &&
          log.outcome === null &&
          log.source === "chat_encounter" &&
          !!log.message_id,
      ),
    ).toBe(true);

    await page.getByRole("button", { name: /Your progress/ }).click();
    await page.getByRole("button", { name: /Lexis/ }).click();
    await expect(page.getByRole("cell", { name: "bonjour" })).toBeVisible();
    await page.getByRole("cell", { name: "bonjour" }).click();
    await expect(page.locator(".item-hero")).toContainText("bonjour");
    await expect(
      page.locator(".stat-grid div").filter({ hasText: "Seen" }).locator("strong"),
    ).toHaveText("1");
    await expect(
      page.locator(".stat-grid div").filter({ hasText: "Produced" }).locator("strong"),
    ).toHaveText("0");
    await expect(page.locator(".profile-message-row")).toContainText("bonjour");
  });

  test("self-corrected vocabulary is not credited as a clean production", async ({
    page,
    request,
  }) => {
    const api = new TestApi(request);
    await api.setExplainResponse("je vois le chatt", {
      corrected_message: "je vois le chat",
      explanations: [],
      additional_errors: [
        {
          start: 11,
          end: 16,
          text: "chatt",
          corrected: "chat",
          kind: "grammar",
          rule: "spelling repair",
          explanations: { en: "Use **chat** here." },
        },
      ],
    });
    await api.setVocabResponse("je vois le chat", {
      new_vocabulary: [
        { term: "chat", translation: "cat", context_sentence: "je vois le chat", cefr_level: "A1" },
      ],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await api.setDefaultAgentReply("ok");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("je vois le chatt");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hint-panel")).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("je vois le chat");
    await page.keyboard.press("Enter");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const logs = (await api.dbTable("review_log")) as Array<{
      item_type: string;
      outcome: string | null;
      source: string;
    }>;
    expect(
      logs.some(
        (l) =>
          l.item_type === "vocabulary" &&
          l.outcome === "incorrect" &&
          l.source === "chat_self_correct",
      ),
    ).toBe(true);

    const vocab = (await api.dbTable("vocabulary")) as Array<{
      term: string;
      productions: number;
      correct_productions: number;
      self_corrected_productions: number;
    }>;
    expect(vocab.find((v) => v.term === "chat")).toMatchObject({
      productions: 1,
      correct_productions: 0,
      self_corrected_productions: 1,
    });

    await page.getByRole("button", { name: /Your progress/ }).click();
    await page.getByRole("button", { name: /Lexis/ }).click();
    await expect(page.getByRole("cell", { name: "chat" })).toBeVisible();
    await page.getByRole("cell", { name: "chat" }).click();
    await expect(page.locator(".item-hero")).toContainText("chat");
    await expect(page.locator(".stat-grid")).toContainText("Produced");
    await expect(page.locator(".stat-grid")).toContainText("Self-corrected");
    await expect(page.locator(".stat-grid")).toContainText("1");
    await expect(page.locator(".events-list")).toContainText("self-corrected fail");
    await expect(page.locator(".profile-message-row")).toContainText("je vois le chat");
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
