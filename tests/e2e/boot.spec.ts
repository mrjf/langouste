import { test, expect } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Boot in single-user mode", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("lands straight in the chat view, no login screen", async ({ page }) => {
    await page.goto("/");

    // Sidebar renders with Langouste header.
    await expect(page.getByRole("heading", { name: "Langouste" })).toBeVisible();
    // The three nav items appear.
    await expect(page.getByRole("button", { name: /Chats/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Your progress/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Connections/ })).toBeVisible();
    // No login form fields.
    await expect(page.locator("#email")).toHaveCount(0);
    await expect(page.locator("#password")).toHaveCount(0);
  });

  test("creates a local user and profile on first boot", async ({ page, request }) => {
    await page.goto("/");
    // Wait until the app has stabilised (the sidebar footer has the display name).
    await expect(page.locator(".sidebar-footer")).toContainText("You");

    const api = new TestApi(request);
    const users = await api.dbTable("users");
    const profiles = await api.dbTable("profiles");
    expect(users).toHaveLength(1);
    expect(profiles).toHaveLength(1);
    expect((users[0] as { email: string }).email).toBe("local@langouste");
  });

  test("session persists across reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sidebar-footer")).toContainText("You");

    const firstToken = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("langouste_session") ?? "{}"),
    );
    expect(firstToken?.session?.access_token).toBeTruthy();

    await page.reload();
    await expect(page.locator(".sidebar-footer")).toContainText("You");
    // No login form after reload.
    await expect(page.locator("#email")).toHaveCount(0);
  });
});
