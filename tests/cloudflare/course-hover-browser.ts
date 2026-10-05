import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {loadCourseCatalog} from '../../src/services/course/catalog';
const lessons=await loadCourseCatalog();
const base=Bun.argv[2]??'http://127.0.0.1:8792';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors:string[]=[],unexpected:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')||u.origin!==new URL(base).origin)unexpected.push(r.url());});
await mkdir('/tmp/langouste-hover',{recursive:true});
for(const lang of ['hu','ar-EG']){
 for(const day of [1,15,30,31]){
  const id=day===31?`ai-news-2026-10-04-${lang}`:`ai-news-2026-d${String(day).padStart(2,'0')}-${lang}`;
  await page.goto(`${base}/#/course/${lang}/${id}`);
  await expect(page.getByRole("heading",{name:lessons.find(l=>l.id===id)!.title,exact:true})).toBeVisible();
  const token=page.locator('.reading .dict-word').first();await expect(token).toBeVisible();
  const recordBefore=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('langouste-course-local:v1:'))));
  const box=(await token.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height*.2);
  const gloss=page.getByRole('dialog',{name:'Sentence meaning',exact:true});await expect(gloss).toBeVisible();
  expect(await gloss.locator('.literal-word').count()).toBe(await token.locator('..').locator('..').locator('.dict-word').count());
  await expect(gloss.locator('.natural-translation')).not.toBeEmpty();
  expect(await token.evaluate(el=>getComputedStyle(el).textDecorationLine)).toBe('none');
  await page.mouse.move(box.x+box.width/2,box.y+box.height*.8);
  await expect(gloss).toHaveCount(0);
  const dictionary=page.locator('.dictionary-popover:not(.inline)');await expect(dictionary).toBeVisible();
  await expect(dictionary.locator('.dictionary-context')).not.toBeEmpty();
  // Moving into the popup must not dismiss it after the original leave timer.
  await dictionary.hover();await page.waitForTimeout(450);await expect(dictionary).toBeVisible();
  await page.mouse.move(box.x+box.width/2,box.y+box.height*.2);await expect(gloss).toBeVisible();
  await page.screenshot({path:`/tmp/langouste-hover/${lang}-${day}-gloss.png`});
  const scroll=await page.evaluate(()=>scrollY);
  await token.click({position:{x:box.width/2,y:box.height*.8}});
  await expect(page.locator('.inspector .dictionary-popover.inline')).toBeVisible();
  expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  await expect(page.getByRole('button',{name:'Close reference'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('.inspector')).toHaveCount(0);await expect(token).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(dictionary).toBeVisible();
  await page.keyboard.press('ArrowUp');await expect(gloss).toBeVisible();
  await page.keyboard.press('Enter');await expect(page.locator('.inspector')).toBeVisible();
  await page.getByRole('button',{name:'Close reference'}).click();
  // Hover/sidebar never creates or rewrites a learner record.
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('langouste-course-local:v1:'))))).toEqual(recordBefore);
  expect(await page.evaluate(id=>sessionStorage.getItem(`langouste-study-support:${id}`),id)).toBe('1');
  await page.reload();await expect(page.locator('.reading .dict-word').first()).toBeVisible();
  console.log(`PASS ${lang} day ${day}: split hover, aligned gloss, dictionary/sidebar, keyboard, no underline, no record mutation, reload`);
 }
}
// Rapid word changes cannot leave stale popups or context.
const tokens=page.locator('.reading .dict-word:visible');
for(let i=0;i<Math.min(12,await tokens.count());i++){
 const t=tokens.nth(i),b=(await t.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height*.8);
 await expect(page.locator('.dictionary-popover:not(.inline)')).toHaveAttribute('aria-label',`Dictionary entry for ${await t.innerText()}`);
}
await page.keyboard.press('Escape');await expect(page.locator('.dictionary-popover:not(.inline)')).toHaveCount(0);
// Touch gets a stable sentence card with an explicit dictionary action.
const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const mobile=await touch.newPage();
await mobile.goto(`${base}/#/course/ar-EG/ai-news-2026-d01-ar-EG`);
await mobile.locator('.reading .dict-word').first().tap();await expect(mobile.getByRole('dialog',{name:'Sentence meaning'})).toBeVisible();
await mobile.getByRole('button',{name:'Word dictionary',exact:true}).tap();await expect(mobile.locator('.inspector')).toBeVisible();
expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
await mobile.screenshot({path:'/tmp/langouste-hover/mobile-dictionary.png'});
expect(errors).toEqual([]);expect(unexpected).toEqual([]);
console.log('PASS rapid word changes, touch dictionary, RTL/mobile overflow, no API or third-party requests, no console errors');
await browser.close();
