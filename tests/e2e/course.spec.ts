import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { getLocalToken, TestApi } from "./helpers";

test("course practice persists on the server, resumes, and separates languages", async ({
  page,
  request,
}) => {
  await new TestApi(request).fullReset();
  await page.goto("/#/course/hu");
  await expect(page.getByRole("heading", { name: "Hungarian", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New tools and useful questions" })).toBeVisible();
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await page.getByRole("button", { name: /This is a new tool\./ }).click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("That’s right");
  await page.getByRole("button", { name: "Check practice answer" }).click();
  await expect(page.getByRole("status")).toContainText("no independent recall credit");
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByRole("heading", { name: /Ez egy új _____/ })).toBeVisible();
  await page.getByRole("button", { name: "Show answer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("képzés");
  await page.reload();
  await expect(page.getByRole("heading", { name: /Ez egy új _____/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("képzés");
  await page.getByLabel("Your answer", { exact: true }).fill("képzés");
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("no independent recall credit");
  const token = await getLocalToken(request);
  const response = await request.get("/api/course/ai-news-2026-d01-hu", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const saved = await response.json();
  expect(saved.progress.exercises.hu_d01_q01.attempts).toHaveLength(2);
  expect(saved.progress.exercises.hu_d01_q02.revealed).toBe(true);
  expect(saved.progress.exercises.hu_d01_q02.attempts[0].scored).toBe(false);
  await page.getByRole("button", { name: "Egyptian Arabic", exact: true }).click();
  await expect(page.getByText("0 / 30", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('[lang="ar-EG"][dir="rtl"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Exercises", exact: true }).click();
  await expect(page.locator(".choices")).toContainText("gedeed");
  await expect(page.locator(".choices")).not.toContainText("new (masculine)");
  await page.getByRole("button", { name: /A جديد/ }).click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.locator(".choices")).toContainText("new (masculine)");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".quiz")).toBeVisible();
  await page.screenshot({ path: "/tmp/langouste-course-mobile.png", fullPage: true });
});

const authored = JSON.parse(
  readFileSync(new URL("../../content/ai-course/authored-course.json", import.meta.url), "utf8"),
);
for (const language of ["hu", "ar-EG"])
  for (const day of [1, 15, 30]) {
    test(`rich course UI: ${language}, day ${day}`, async ({ page, request }) => {
      await new TestApi(request).fullReset();
      const lesson = authored.lessons.find(
        (l: { language: string; day: number }) => l.language === language && l.day === day,
      );
      await page.goto(`/#/course/${language}/${lesson.id}`);
      await expect(page.getByRole("heading", { name: lesson.title, exact: true })).toBeVisible();
      await expect(page.locator(".reading")).toHaveCount(3);
      await expect(page.locator(".reading .target").first()).not.toBeEmpty();
      await page.getByRole("button", { name: "Exercises", exact: true }).click();
      async function goTo(index: number) {
        // Return to first question through visible navigation.
        while (await page.getByRole("button", { name: /Previous/ }).isEnabled())
          await page.getByRole("button", { name: /Previous/ }).click();
        for (let i = 0; i < index; i++)
          await page.getByRole("button", { name: /Next question/ }).click();
      }
      const matchingIndex = lesson.exercises.findIndex(
        (e: { type: string }) => e.type === "matching",
      );
      await goTo(matchingIndex);
      const matching = lesson.exercises[matchingIndex];
      for (const pair of matching.matchingPairs)
        await page
          .getByLabel(`Meaning for ${pair.text}`, { exact: true })
          .selectOption(pair.answer);
      await page.getByRole("button", { name: "Check answer", exact: true }).click();
      await expect(page.locator(".feedback")).toContainText("That’s right");
      await expect(page.locator(".matching-pairs")).toContainText("✓ Matched");
      const orderIndex = lesson.exercises.findIndex((e: { type: string }) => e.type === "order");
      if (orderIndex >= 0) {
        await goTo(orderIndex);
        const order = lesson.exercises[orderIndex];
        await expect(page.locator(".tokens button")).toHaveCount(order.choices.length);
        for (let i = 0; i < order.choices.length; i++)
          await page.locator(".tokens button").nth(i).click();
        await page.getByRole("button", { name: "Check answer", exact: true }).click();
        await expect(page.locator(".feedback")).toContainText("no independent recall credit");
      }
      const openIndex = lesson.exercises.findIndex(
        (e: { type: string }) => e.type === "self-check",
      );
      if (openIndex >= 0) {
        await goTo(openIndex);
        await page
          .getByLabel("Your response", { exact: true })
          .fill("My practice response for this isolated test.");
        await page.getByRole("button", { name: "Check answer", exact: true }).click();
        await expect(page.locator(".rubric")).toBeVisible();
        await page.getByRole("button", { name: "Partly meets it", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Partly meets it", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        const token = await getLocalToken(request);
        const response = await request.get(`/api/course/${lesson.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const saved = await response.json();
        expect(saved.progress.exercises[lesson.exercises[openIndex].id].attempts[0]).toMatchObject({
          correct: null,
          scored: false,
          selfAssessment: "close",
        });
      }
      await page.getByRole("button", { name: /Course map/ }).click();
      await expect(page.locator(".day-card")).toHaveCount(30);
      if (day === 30 && language === "hu")
        await page.screenshot({ path: "/tmp/langouste-course-desktop.png", fullPage: true });
    });
  }
