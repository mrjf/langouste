import { type Page, expect } from "@playwright/test";

const BASE_API = "http://localhost:8000/api";

/**
 * Generate a unique test user for each test run.
 */
export function testUser(suffix?: string) {
  const id = suffix ?? Math.random().toString(36).slice(2, 8);
  return {
    email: `test-${id}@langouste.test`,
    password: "test-password-123",
    displayName: `Test User ${id}`,
    baseLang: "en",
    targetLang: "fr",
    cefrLevel: "A1",
  };
}

/**
 * Sign up a new user via the API directly (bypasses UI for speed).
 * Returns the session and user objects.
 */
export async function apiSignup(user: ReturnType<typeof testUser>) {
  const res = await fetch(`${BASE_API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      display_name: user.displayName,
      base_language: user.baseLang,
      learning_languages: [
        { lang: user.targetLang, cefr_level: user.cefrLevel, assessed_at: new Date().toISOString() },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Signup failed: ${err.error}`);
  }
  return res.json();
}

/**
 * Log in a user via the API directly.
 */
export async function apiLogin(email: string, password: string) {
  const res = await fetch(`${BASE_API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Login failed: ${err.error}`);
  }
  return res.json();
}

/**
 * Inject an authenticated session into the browser's localStorage
 * so the app loads straight into the main view (skip login UI).
 */
export async function injectSession(
  page: Page,
  session: { session: unknown; user: unknown },
) {
  await page.addInitScript((data) => {
    localStorage.setItem("langouste_session", JSON.stringify(data));
  }, session);
}

/**
 * Sign up via the UI form.
 */
export async function signupViaUI(page: Page, user: ReturnType<typeof testUser>) {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Langouste");

  // Switch to signup mode
  await page.getByRole("button", { name: "Sign up" }).click();

  // Fill form
  await page.fill("#display_name", user.displayName);
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);

  // Select base language
  await page.locator("select[name='base_language']").selectOption(user.baseLang);
  // Select target language
  await page.locator("select[name='learning_language']").selectOption(user.targetLang);
  // Select CEFR level
  await page.locator("#cefr").selectOption(user.cefrLevel);

  // Submit
  await page.getByRole("button", { name: "Sign Up" }).click();
}

/**
 * Log in via the UI form.
 */
export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Langouste");

  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Log In" }).click();
}

/**
 * Wait for the main app layout to be visible (logged-in state).
 */
export async function expectLoggedIn(page: Page) {
  await expect(page.locator(".layout")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
}

/**
 * Create a new person-to-person conversation via the UI.
 */
export async function createConversation(page: Page) {
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByText("Chat with a person").click();
  // Wait for the conversation to load
  await expect(page.locator(".thread-header")).toBeVisible({ timeout: 10_000 });
}

/**
 * Type text into the MessageInput contenteditable.
 */
export async function typeMessage(page: Page, text: string) {
  const editable = page.locator(".editable[contenteditable='true']");
  await editable.click();
  await editable.fill(text);
}

/**
 * Press Enter in the MessageInput to trigger the check/send pipeline.
 */
export async function pressEnter(page: Page) {
  const editable = page.locator(".editable[contenteditable='true']");
  await editable.press("Enter");
}
