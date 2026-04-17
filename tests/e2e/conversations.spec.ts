import { test, expect } from "@playwright/test";
import {
  testUser,
  signupViaUI,
  expectLoggedIn,
} from "./helpers";

test.describe("Conversations", () => {
  test("empty state shows no conversations", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await expect(page.locator(".conv-empty")).toContainText("No conversations yet");
    await expect(page.locator(".empty-state")).toContainText("Select a conversation");
  });

  test("new chat dialog opens straight to agent picker", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await page.getByRole("button", { name: "+ New" }).click();

    await expect(page.getByText("+ New agent connector")).toBeVisible();
  });

  test("new agent connector form shows connector type options", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByText("+ New agent connector").click();

    await expect(page.getByText("Claude (Anthropic API)")).toBeVisible();
    await expect(page.getByText("OpenClaw (local agent)")).toBeVisible();
    await expect(page.getByText("HTTP endpoint")).toBeVisible();
  });
});
