import { test, expect } from "@playwright/test";
import { testUser, signupViaUI, loginViaUI, expectLoggedIn } from "./helpers";

test.describe("Authentication", () => {
  test("shows login form on first visit", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Langouste");
    await expect(page.locator("text=Learn languages through real conversation")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();
  });

  test("can switch between login and signup forms", async ({ page }) => {
    await page.goto("/");

    // Default is login mode
    await expect(page.locator("#display_name")).not.toBeVisible();

    // Switch to signup
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.locator("#display_name")).toBeVisible();
    await expect(page.locator("select[name='base_language']")).toBeVisible();
    await expect(page.locator("select[name='learning_language']")).toBeVisible();
    await expect(page.locator("#cefr")).toBeVisible();

    // Switch back to login
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#display_name")).not.toBeVisible();
  });

  test("signup creates account and enters main app", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    // Display name is visible in sidebar footer
    await expect(page.locator(".sidebar-footer")).toContainText(user.displayName);
  });

  test("login with existing account enters main app", async ({ page }) => {
    const user = testUser();

    // First sign up
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    // Log out
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.locator("h1")).toContainText("Langouste");

    // Log back in
    await loginViaUI(page, user.email, user.password);
    await expectLoggedIn(page);
    await expect(page.locator(".sidebar-footer")).toContainText(user.displayName);
  });

  test("login with wrong password shows error", async ({ page }) => {
    await page.goto("/");
    await page.fill("#email", "nonexistent@test.com");
    await page.fill("#password", "wrongpassword");
    await page.getByRole("button", { name: "Log In" }).click();

    await expect(page.locator(".error-msg")).toBeVisible({ timeout: 5_000 });
  });

  test("session persists across page reload", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    // Reload the page
    await page.reload();
    await expectLoggedIn(page);
    await expect(page.locator(".sidebar-footer")).toContainText(user.displayName);
  });

  test("logout clears session and shows login", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await page.getByRole("button", { name: "Logout" }).click();

    await expect(page.locator("h1")).toContainText("Langouste");
    await expect(page.locator("#email")).toBeVisible();

    // Reload should not auto-login
    await page.reload();
    await expect(page.locator("#email")).toBeVisible();
  });
});
