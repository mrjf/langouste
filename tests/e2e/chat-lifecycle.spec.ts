import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Chat lifecycle", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("start a chat, send a message, see the agent reply", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("Bonjour !");

    await seedConnector(request, "stub");
    await page.goto("/");

    // Open the new-chat dialog.
    await page.getByRole("button", { name: "New", exact: true }).click();
    // Pick the stub connection.
    await page.getByRole("button", { name: /stub/i }).click();

    // We're now in a chat thread.
    await expect(page.locator(".thread-header")).toBeVisible();

    // Type a message and send it.
    await typeMessage(page, "Salut `Biscuit`");
    // Plain Enter runs the pipeline. Our default explain is a no-op so it
    // submits without extra steps.
    await page.keyboard.press("Enter");

    // The user's message appears.
    await expect(page.locator(".messages").getByText("Salut")).toBeVisible();
    // The agent reply arrives.
    await expect(page.locator(".messages").getByText("Bonjour !")).toBeVisible({ timeout: 15_000 });

    // Sidebar shows the conversation.
    await expect(page.locator(".conv-item")).toHaveCount(1);
  });

  test("stored messages are retrievable via the API", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("ok");
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await typeMessage(page, "Hello there");
    await page.keyboard.press("Enter");
    await expect(page.locator(".messages").getByText("ok")).toBeVisible({ timeout: 15_000 });

    const rows = (await api.dbTable("messages")) as Array<{
      raw_text: string;
      is_agent: number;
    }>;
    // 1 user message + 1 agent reply.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const userMsg = rows.find((r) => !r.is_agent);
    const agentMsg = rows.find((r) => !!r.is_agent);
    expect(userMsg?.raw_text).toBe("Hello there");
    expect(agentMsg?.raw_text).toBe("ok");
  });

  test("shows and hides every configured message language", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("Bien sûr");
    await setLearningLanguages(request, ["fr", "es"]);
    await seedConnector(request, "stub");

    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: /stub/i }).click();
    await typeMessage(page, "Bonjour");
    await page.keyboard.press("Enter");
    await expect(page.locator(".messages .message-bubble")).toHaveCount(2, { timeout: 15_000 });

    const firstBubble = page.locator(".messages .message-bubble").first();
    await firstBubble.getByRole("button", { name: "🇪🇸 es" }).click();
    await expect(page.locator(".messages .details")).toHaveCount(1);
    await page.getByRole("button", { name: "Show all languages" }).click();
    await expect(page.getByRole("button", { name: "Hide all languages" })).toBeVisible();
    await expect(page.locator(".messages .details")).toHaveCount(2);
    await expect(
      page.locator(".messages .details").getByText("🇪🇸 es", { exact: true }),
    ).toHaveCount(2);

    await page.getByRole("button", { name: "Hide all languages" }).click();
    await expect(page.locator(".messages .details")).toHaveCount(0);
  });
});

// --- helpers local to this file ---

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
  languages: string[],
): Promise<void> {
  const token = (await (await request.post("/api/auth/local")).json()).session.access_token;
  const res = await request.patch("/api/profile", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      learning_languages: languages.map((lang) => ({
        lang,
        cefr_level: "A1",
        assessed_at: "",
      })),
    },
  });
  if (!res.ok()) throw new Error(`profile update failed: ${res.status()} ${await res.text()}`);
}

async function typeMessage(page: import("@playwright/test").Page, text: string): Promise<void> {
  const editable = page.locator(".editable[contenteditable='true']");
  await editable.click();
  await page.keyboard.type(text);
}
