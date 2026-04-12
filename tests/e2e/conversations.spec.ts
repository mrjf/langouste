import { test, expect } from "@playwright/test";
import {
  testUser,
  signupViaUI,
  expectLoggedIn,
  createConversation,
  apiSignup,
  injectSession,
} from "./helpers";

test.describe("Conversations", () => {
  test("empty state shows no conversations", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await expect(page.locator(".conv-empty")).toContainText("No conversations yet");
    await expect(page.locator(".empty-state")).toContainText("Select a conversation");
  });

  test("can create a new person-to-person conversation", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await createConversation(page);

    // Should show the conversation in the sidebar
    await expect(page.locator(".conv-item")).toBeVisible();

    // Should show "Waiting for partner" since no one else has joined
    await expect(page.locator(".partner-name")).toContainText("Waiting for partner");

    // Should show invite link banner
    await expect(page.locator(".invite-banner")).toBeVisible();
  });

  test("new chat dialog shows agent and person options", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await page.getByRole("button", { name: "+ New" }).click();

    await expect(page.getByText("Chat with a person")).toBeVisible();
    await expect(page.getByText("Chat with an agent")).toBeVisible();
  });

  test("conversation shows language selector with user's target language", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await createConversation(page);

    // Should have "Practicing" and "Hints in" selectors
    await expect(page.locator("text=Practicing")).toBeVisible();
    await expect(page.locator("text=Hints in")).toBeVisible();
  });

  test("can copy invite link", async ({ page, context }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await createConversation(page);

    const copyBtn = page.locator(".btn-copy-link");
    await expect(copyBtn).toContainText("Copy invite link");
    await copyBtn.click();
    await expect(copyBtn).toContainText("Copied!");
  });

  test("selecting a conversation loads the chat thread", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    await createConversation(page);

    // The thread header should be visible
    await expect(page.locator(".thread-header")).toBeVisible();

    // The input area should be visible
    await expect(page.locator(".input-area")).toBeVisible();

    // The message input component should be present
    await expect(page.locator(".message-input")).toBeVisible();
  });

  test("conversation appears in sidebar after creation", async ({ page }) => {
    const user = testUser();
    await signupViaUI(page, user);
    await expectLoggedIn(page);

    // No conversations initially
    await expect(page.locator(".conv-empty")).toBeVisible();

    await createConversation(page);

    // Now there should be a conversation in the list
    await expect(page.locator(".conv-item")).toHaveCount(1);
    await expect(page.locator(".conv-empty")).not.toBeVisible();
  });
});
