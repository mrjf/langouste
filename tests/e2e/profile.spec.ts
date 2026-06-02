import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { BASE_URL, TestApi, getLocalToken } from "./helpers";

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
      grammar_gaps_detected: [{ category: "verb:agreement", description: "Subject-verb mismatch" }],
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
    await expect(tiles.filter({ hasText: "Vocabulary items" }).locator(".tile-value")).toHaveText(
      "1",
    );
    await expect(tiles.filter({ hasText: "Grammar concepts" }).locator(".tile-value")).toHaveText(
      "1",
    );
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
    await page.route(/\/api\/profile\/item\/vocabulary\/[^/]+\/reference(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          term: "manger",
          language: "fr",
          source_term: "manger",
          source: "wiktionary",
          source_url: "https://en.wiktionary.org/wiki/manger",
          part_of_speech: "Verb",
          pronunciations: [],
          conjugation_html:
            '<h4 id="Conjugation">Conjugation</h4><table class="inflection-table vsSwitcher"><tbody><tr><th>Present</th><td>je mange</td></tr></tbody></table>',
          links: [],
          notes: [],
        }),
      });
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "je mange");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /Your progress/ }).click();
    await expect(page).toHaveURL(/#\/profile\/fr$/);
    // Click the Lexis dimension card.
    await page.getByRole("button", { name: /Lexis/ }).click();
    await expect(page).toHaveURL(/#\/profile\/fr\/lexis$/);
    // Item shows up in the table.
    await expect(page.getByRole("cell", { name: "manger" })).toBeVisible();
    await page.getByRole("cell", { name: "manger" }).click();
    await expect(page).toHaveURL(/#\/profile\/fr\/lexis\/vocabulary\/manger$/);
    // Item detail panel shows linked message.
    await expect(page.locator(".item-hero")).toContainText("manger");
    await expect(page.locator(".item-hero")).toContainText("Verb");
    await expect(page.locator(".reference-html table")).toBeVisible();
    await expect(page.locator(".reference-html")).toContainText("je mange");
    // The linked-messages section has a button per message.
    await expect(
      page.locator(".profile-message-row").filter({ hasText: "je mange" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator(".item-hero")).toContainText("manger");
    await expect(page).toHaveURL(/#\/profile\/fr\/lexis\/vocabulary\/manger$/);
  });

  test("language selection has a stable refreshable URL", async ({ page, request }) => {
    await setLearningLanguages(request, [
      { lang: "fr", cefr_level: "A1", assessed_at: "2026-01-01T00:00:00.000Z" },
      { lang: "es", cefr_level: "A1", assessed_at: "2026-01-01T00:00:00.000Z" },
    ]);

    await page.goto("/#/profile");
    await expect(page).toHaveURL(/#\/profile\/fr$/);

    await page.getByRole("button", { name: /Spanish/ }).click();
    await expect(page).toHaveURL(/#\/profile\/es$/);
    await expect(page.getByRole("button", { name: /Spanish/ })).toHaveClass(/active/);

    await page.reload();
    await expect(page).toHaveURL(/#\/profile\/es$/);
    await expect(page.getByRole("button", { name: /Spanish/ })).toHaveClass(/active/);
  });

  test("sidebar chat selection leaves profile and opens the chat", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ok");
    await api.setDefaultVocabResponse({
      new_vocabulary: [],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "bonjour");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /Your progress/ }).click();
    await expect(page.getByRole("heading", { name: "Your progress" })).toBeVisible();

    await page.locator(".conv-item").filter({ hasText: "stub" }).click();
    await expect(page.getByRole("button", { name: /Chats/ })).toHaveClass(/active/);
    await expect(page).toHaveURL(/#\/c\/.+/);
    await expect(page.locator(".messages").getByText("bonjour")).toBeVisible();
  });

  test("target-language words show dictionary definitions on hover", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ok");
    await api.setDefaultVocabResponse({
      new_vocabulary: [],
      grammar_gaps_detected: [],
      next_challenge: "",
    });
    await page.route(/\/api\/dictionary\?/, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          term: "bonjour",
          language: "fr",
          source: "wiktionary",
          source_term: "bonjour",
          source_url: "https://en.wiktionary.org/wiki/bonjour",
          definitions: ["hello; good morning"],
        }),
      });
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "bonjour");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });

    await page.locator(".messages .dict-word").filter({ hasText: "bonjour" }).first().hover();
    await expect(page.getByRole("tooltip")).toContainText("hello; good morning");
  });

  test("syntax item detail does not fetch or show lexical reference", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ok");
    await api.setDefaultVocabResponse({
      new_vocabulary: [],
      grammar_gaps_detected: [
        {
          category: "articles:definite_vs_indefinite",
          description:
            "The learner used 'egy' where 'a' would be more natural for a specific README.",
        },
      ],
      next_challenge: "",
    });
    let referenceCalled = false;
    await page.route(/\/api\/profile\/item\/grammar\/[^/]+\/reference$/, async (route) => {
      referenceCalled = true;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "grammar items must not fetch lexical references" }),
      });
    });
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await sendMessage(page, "bad syntax");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /Your progress/ }).click();
    await page.getByRole("button", { name: /Syntax/ }).click();
    await expect(page).toHaveURL(/#\/profile\/fr\/syntax$/);
    await expect(page.getByRole("cell", { name: /Definite vs\. Indefinite Articles/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Definite vs\. indefinite article usage/ })).toBeVisible();
    await expect(page.getByText("articles:definite_vs_indefinite")).toHaveCount(0);
    await expect(page.getByText("u:syntax:determiner.definiteness")).toHaveCount(0);
    await expect(page.getByText("The learner used 'egy'")).toHaveCount(0);
    await page.getByRole("cell", { name: /Definite vs\. Indefinite Articles/ }).click();
    await expect(page).toHaveURL(/#\/profile\/fr\/syntax\/grammar\/.+/);
    await expect(page.locator(".item-hero")).toContainText("Definite vs. Indefinite Articles");
    await expect(page.locator(".item-hero")).toContainText("Definite vs. indefinite article usage");
    await expect(page.getByText("articles:definite_vs_indefinite")).toHaveCount(0);
    await expect(page.getByText("u:syntax:determiner.definiteness")).toHaveCount(0);
    await expect(page.getByText("The learner used 'egy'")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reference" })).toHaveCount(0);
    await expect(page.getByText("No Wiktionary conjugation table was found")).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(referenceCalled).toBe(false);
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

async function setLearningLanguages(
  request: APIRequestContext,
  learningLanguages: Array<{ lang: string; cefr_level: string; assessed_at: string }>,
): Promise<void> {
  const token = await getLocalToken(request);
  const res = await request.patch(`${BASE_URL}/api/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { learning_languages: learningLanguages },
  });
  if (!res.ok()) {
    throw new Error(`profile patch failed: ${res.status()} ${await res.text()}`);
  }
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const editable = page.locator(".editable[contenteditable='true']");
  await editable.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
