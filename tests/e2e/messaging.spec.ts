import { test, expect } from "@playwright/test";
import {
  testUser,
  signupViaUI,
  expectLoggedIn,
  createConversation,
  typeMessage,
  pressEnter,
} from "./helpers";

test.describe("Message Input", () => {
  // Set up: create a user and conversation before each test
  let user: ReturnType<typeof testUser>;

  test.beforeEach(async ({ page }) => {
    user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);
    await createConversation(page);
    // Ensure the message input is ready
    await expect(page.locator(".message-input")).toBeVisible();
  });

  test("input area has contenteditable and intent field", async ({ page }) => {
    // Main editable area
    const editable = page.locator(".editable[contenteditable='true']");
    await expect(editable).toBeVisible();

    // Intent textarea
    const intent = page.locator(".intent-input");
    await expect(intent).toBeVisible();
    await expect(intent).toHaveAttribute("placeholder", /What are you trying to say/);
  });

  test("shows language indicator", async ({ page }) => {
    const langBtn = page.locator(".lang-flag-btn");
    await expect(langBtn).toBeVisible();
    // Should show the user's target language (French)
    await expect(langBtn).toContainText("fr");
  });

  test("can type in the contenteditable field", async ({ page }) => {
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour le monde");

    // The text should appear in the editable
    await expect(editable).toContainText("Bonjour le monde");
  });

  test("can type in the intent field", async ({ page }) => {
    const intent = page.locator(".intent-input");
    await intent.fill("Hello world");
    await expect(intent).toHaveValue("Hello world");
  });

  test("Enter triggers check pipeline and sends clean message", async ({ page }) => {
    // Intercept the check API call
    const checkPromise = page.waitForResponse(
      (res) => res.url().includes("/check") && res.request().method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour");

    // Press Enter to trigger check
    await editable.press("Enter");

    const checkResponse = await checkPromise;
    const checkBody = await checkResponse.json();

    // "Bonjour" is a correct French word — should be clean
    expect(checkBody.clean).toBe(true);
    expect(checkBody.errors).toHaveLength(0);
    expect(checkBody.language).toBe("fr");
  });

  test("clean message appears in chat thread after send", async ({ page }) => {
    // Wait for both check and send to complete
    const sendPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/messages/") &&
        !res.url().includes("/check") &&
        !res.url().includes("/explain") &&
        !res.url().includes("/translate") &&
        res.request().method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour");
    await editable.press("Enter");

    await sendPromise;

    // Message should appear in the messages area
    const bubble = page.locator(".message-bubble.sent");
    await expect(bubble.first()).toBeVisible({ timeout: 10_000 });
    await expect(bubble.first().locator(".healed-text")).toContainText("Bonjour");
  });

  test("input clears after sending", async ({ page }) => {
    const sendPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/messages/") &&
        !res.url().includes("/check") &&
        !res.url().includes("/explain") &&
        !res.url().includes("/translate") &&
        res.request().method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour");
    await editable.press("Enter");

    await sendPromise;

    // Input should be cleared
    await expect(editable).toHaveText("");
  });

  test("misspelled word triggers errors from check endpoint", async ({ page }) => {
    const checkPromise = page.waitForResponse(
      (res) => res.url().includes("/check") && res.request().method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    // "Bonjouur" is intentionally misspelled
    await page.keyboard.type("Bonjouur");
    await editable.press("Enter");

    const checkResponse = await checkPromise;
    const checkBody = await checkResponse.json();

    // Should detect spelling errors
    expect(checkBody.clean).toBe(false);
    expect(checkBody.errors.length).toBeGreaterThan(0);
    expect(checkBody.errors[0].kind).toBe("spelling");
  });

  test("spelling errors show squiggly underlines", async ({ page }) => {
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjouur");
    await editable.press("Enter");

    // Wait for squiggles to appear in the decoration overlay
    const squiggle = page.locator(".decoration-overlay .squiggle-spelling");
    await expect(squiggle).toBeVisible({ timeout: 10_000 });
  });

  test("hint panel appears after explanation from Opus", async ({ page }) => {
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjouur");
    await editable.press("Enter");

    // Wait for the hint panel (from Opus explanation)
    // This may take a while since it calls Opus
    const hintPanel = page.locator(".hint-panel:not(.loading)");
    await expect(hintPanel).toBeVisible({ timeout: 30_000 });

    // Should show error count
    await expect(hintPanel.locator(".hint-title")).toContainText("error");
  });

  test("Shift+Enter inserts newline instead of submitting", async ({ page }) => {
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Line 1");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Line 2");

    const text = await editable.innerText();
    expect(text).toContain("Line 1");
    expect(text).toContain("Line 2");

    // Should NOT have triggered a send (no message bubble)
    await expect(page.locator(".message-bubble")).not.toBeVisible();
  });

  test("send endpoint receives correct body shape", async ({ page }) => {
    const sendPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/messages/") &&
        !req.url().includes("/check") &&
        !req.url().includes("/explain") &&
        !req.url().includes("/translate") &&
        req.method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Salut");
    await editable.press("Enter");

    const sendRequest = await sendPromise;
    const body = sendRequest.postDataJSON();

    // New API shape: { text, language, intent? }
    expect(body).toHaveProperty("text");
    expect(body).toHaveProperty("language");
    expect(body.text).toBe("Salut");
    expect(body.language).toBe("fr");
  });
});

test.describe("Message Display", () => {
  test("sent message shows with correct styling", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);
    await createConversation(page);

    const sendPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/messages/") &&
        !res.url().includes("/check") &&
        !res.url().includes("/explain") &&
        !res.url().includes("/translate") &&
        res.request().method() === "POST",
    );

    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour");
    await editable.press("Enter");

    await sendPromise;

    // Sent message should be aligned right
    const sentBubble = page.locator(".message-bubble.sent");
    await expect(sentBubble.first()).toBeVisible({ timeout: 10_000 });

    // Should show timestamp
    await expect(sentBubble.first().locator(".timestamp")).toBeVisible();
  });

  test("multiple messages appear in chronological order", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);
    await createConversation(page);

    // Send first message
    const editable = page.locator(".editable[contenteditable='true']");
    await editable.click();
    await page.keyboard.type("Bonjour");
    await editable.press("Enter");

    // Wait for first message
    await expect(page.locator(".message-bubble.sent")).toHaveCount(1, { timeout: 10_000 });

    // Send second message
    await editable.click();
    await page.keyboard.type("Salut");
    await editable.press("Enter");

    // Wait for second message
    await expect(page.locator(".message-bubble.sent")).toHaveCount(2, { timeout: 10_000 });

    // Messages should appear in order
    const texts = await page.locator(".message-bubble.sent .healed-text").allInnerTexts();
    expect(texts[0]).toContain("Bonjour");
    expect(texts[1]).toContain("Salut");
  });
});
