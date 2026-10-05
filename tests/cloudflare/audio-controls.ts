import { chromium, expect } from "@playwright/test";
import { loadCourseCatalog } from "../../src/services/course/catalog.ts";
import { audioKey } from "../../src/services/ai/course-audio.ts";
const l = (await loadCourseCatalog()).find((l) => l.language === "ar-EG" && l.day === 1)!;
const text = l.readings[0].sentences[0].text;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
// Test the player's properties only: no synthetic pronunciation is created or presented.
await page.addInitScript(() => {
  (window as any).Audio = class {
    playbackRate = 1;
    preservesPitch = false;
    pause() {}
    play() {
      (window as any).__playback = { rate: this.playbackRate, pitch: this.preservesPitch };
      return Promise.resolve();
    }
  };
});
await page.route("**/audio/manifest.json", (r) =>
  r.fulfill({
    json: { [audioKey(l.language, text)]: { url: "/audio/isolated-control-fixture.mp3" } },
  }),
);
await page.route("**/audio/isolated-control-fixture.mp3", (r) => r.fulfill({ status: 204 }));
await page.goto(`http://localhost:8791/#/course/${l.language}/${l.id}`);
await page
  .getByRole("button", { name: `Play pronunciation: ${text}`, exact: true })
  .first()
  .click();
expect(await page.evaluate(() => (window as any).__playback)).toEqual({ rate: 1, pitch: true });
await page
  .getByRole("button", { name: `Play slowly: ${text}`, exact: true })
  .first()
  .click();
expect(await page.evaluate(() => (window as any).__playback)).toEqual({ rate: 0.75, pitch: true });
await browser.close();
console.log(
  "PASS: normal and slow controls preserve pitch and reuse the same cached asset (media playback mocked; pronunciation quality not tested).",
);
