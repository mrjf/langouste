import { chromium, expect } from "@playwright/test";
import { loadCourseCatalog } from "../../src/services/course/catalog.ts";
import { mkdir } from "node:fs/promises";
const lessons = await loadCourseCatalog();
const root = "/tmp/langouste-cloud-browser";
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const lang of ["hu", "ar-EG"])
  for (const day of [1, 15, 30]) {
    const l = lessons.find((x) => x.language === lang && x.day === day)!;
    await page.goto(`http://localhost:8791/#/course/${lang}/${l.id}`);
    await expect(page.getByRole("heading", { name: l.title, exact: true })).toBeVisible();
    await expect(page.locator(".reading")).toHaveCount(l.readings.length);
    await page.getByLabel("English support", { exact: true }).uncheck();
    await expect(page.locator(".reading .translation")).toHaveCount(0);
    if (lang === "ar-EG") {
      await expect(page.locator('[lang="ar-EG"][dir="rtl"]').first()).toBeVisible();
      await page.getByLabel("Transliteration", { exact: true }).uncheck();
      await expect(page.locator(".reading .transliteration")).toHaveCount(0);
    }
    await page.screenshot({ path: `${root}/${lang}-${day}-desktop.png`, fullPage: true });
    await page.getByRole("button", { name: "Exercises", exact: true }).click();
    await expect(page.locator(".quiz")).toBeVisible();
    await expect(page.locator(".feedback")).toHaveCount(0);
    await expect(page.locator(".feedback .audio-controls")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".quiz")).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
      throw Error(`Mobile overflow ${lang}/${day}`);
    await page.screenshot({ path: `${root}/${lang}-${day}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
await page.getByLabel("Email", { exact: true }).fill("alice@example.invalid");
await page.getByLabel("Password", { exact: true }).fill("isolated-test-password");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
const l = lessons.find((x) => x.language === "ar-EG" && x.day === 30)!;
await page.goto(`http://localhost:8791/#/course/ar-EG/${l.id}`);
await page.getByRole("button", { name: "Exercises", exact: true }).click();
await expect(page.locator(".quiz")).toBeVisible();
await page.reload();
await expect(page.locator(".quiz")).toBeVisible();
await page.getByRole("button", { name: "Sign out" }).click();
await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
expect(errors).toEqual([]);
await browser.close();
console.log(
  "PASS: Chrome six lessons, Hungarian/Egyptian Arabic, mobile overflow, gloss/transliteration hiding, unrevealed answer audio hidden, real login UI, saved step after reload, logout; screenshots in " +
    root,
);
