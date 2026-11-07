import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

async function selectImage(input, index = 0) {
  await input.evaluate((el, index) => { const at = [...el.value.matchAll(/\ufffc/g)][index].index; el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select', { bubbles: true })); }, index);
}
async function apply(page) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function openProperties(page, input, index = 0) {
  await selectImage(input, index); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
}

test('authors large crop outsets and preserves them while editing reopened image properties',async({page},info)=>{
 await page.goto('/playground.html');await showAllTools(page);await page.getByRole('button',{name:'New',exact:true}).click();
 const input=page.getByRole('textbox',{name:'Document text'});
 const png=unzipSync(readFileSync('public/fixtures/cropped-images.docx'))['word/media/image1.png'];
 await page.getByLabel('Insert image file').setInputFiles({name:'panels.png',mimeType:'image/png',buffer:Buffer.from(png)});
 await expect(input).toHaveValue('\ufffc');await openProperties(page,input);
 await page.getByLabel('Image width (in)',{exact:true}).fill('1');await apply(page);await input.press('ArrowRight');
 const full=await firstPicturePixels(page);
 await openProperties(page,input);await page.getByLabel('Crop left (%)').fill('-1500');await apply(page);await input.press('ArrowRight');
 const cropped=await firstPicturePixels(page);
 expect(Math.abs(cropped.width-full.width/16)).toBeLessThan(2);
 expect(Math.abs(cropped.x-full.x-full.width*15/16)).toBeLessThan(2);
 const saved=await download(page,info,'large-crop.docx');await reopenDocx(page,input,saved,'\ufffc');
 await openProperties(page,input);await expect(page.getByLabel('Crop left (%)')).toHaveValue('-1500');
 await page.getByLabel('Image alt text').fill('Large outset retained');await apply(page);await input.press('ArrowRight');
 expect(await firstPicturePixels(page)).toEqual(cropped);
 await openProperties(page,input);await expect(page.getByLabel('Crop left (%)')).toHaveValue('-1500');
 await page.getByRole('button',{name:'Reset crop',exact:true}).click();await apply(page);await input.press('ArrowRight');
 expect(await firstPicturePixels(page)).toEqual(full);
});
async function screenshot(page, testInfo, index, name) {
  const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL()); writeFileSync(testInfo.outputPath(name), Buffer.from(png.split(',')[1], 'base64'));
}
// Locate the first contiguous color band, including interpolated edge pixels.
// Measurements come from rendered pixels, independently of engine layout objects.
async function firstPicturePixels(page) {
  return page.locator('canvas.canvas-page').first().evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), ratio = canvas.width / parseFloat(canvas.style.width);
    let left = Infinity, top = -1, right = 0, bottom = 0, blue = 0, orange = 0;
    for (let y = 0; y < canvas.height; y++) {
      let found = false;
      for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4, b = data[at] === 30 && data[at + 1] === 90 && data[at + 2] === 180, o = data[at] === 245 && data[at + 1] === 150 && data[at + 2] === 35;
        const mix = (data[at] - 30) / 215;
        if (mix < 0 || mix > 1 || Math.abs(data[at + 1] - 90 - 60 * mix) > 2 || Math.abs(data[at + 2] - 180 + 145 * mix) > 2) continue;
        found = true; if (top < 0) top = y; left = Math.min(left, x); right = Math.max(right, x); bottom = y; blue += Number(b); orange += Number(o);
      }
      if (top >= 0 && !found) break;
    }
    if (top < 0) throw new Error('No picture pixels painted');
    return { x: left / ratio, y: top / ratio, width: (right - left + 1) / ratio, height: (bottom - top + 1) / ratio, blue, orange };
  });
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}

test('edits imported crops, preserves DPI metadata on resize, resets a repeated-header crop and reopens the export', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/cropped-images.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Cropped pictures/);
  const initial = await firstPicturePixels(page); expect(initial.blue).toBeGreaterThan(0); expect(initial.orange).toBeGreaterThan(initial.blue);
  const pages = await page.locator('canvas.canvas-page').count(); expect(pages).toBeGreaterThan(2);
  await openProperties(page, input); await expect(page.getByLabel('Crop left (%)')).toHaveValue('25'); await expect(page.getByLabel('Crop top (%)')).toHaveValue('12.5');
  await page.getByLabel('Crop left (%)').fill('100'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('positive source width');
  await page.getByLabel('Crop left (%)').fill('50'); await page.getByLabel('Crop top (%)').fill('0'); await page.getByLabel('Crop bottom (%)').fill('0');
  await page.getByLabel('Image width (in)', { exact: true }).fill('1.5'); await page.getByLabel('Image alt text').fill('Cropped orange panel');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('crop-properties.png') }); await apply(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await input.press('ArrowRight'); await page.keyboard.insertText(' edited');
  const painted = await firstPicturePixels(page); expect(painted.blue).toBe(0); expect(painted.orange).toBeGreaterThan(1000); expect(Math.abs(painted.width - 144)).toBeLessThan(2); expect(Math.abs(painted.height - 72)).toBeLessThan(2);
  await openProperties(page, input, 3); await expect(page.getByLabel('Crop left (%)')).toHaveValue('50');
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click(); await apply(page); await input.press('ArrowRight');
  const count = await page.locator('canvas.canvas-page').count(); expect(count).toBe(pages);
  for (const i of [0, 1, 2]) await screenshot(page, testInfo, i, `cropped-page-${i + 1}.png`);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'cropped-images.docx');
  const original = unzipSync(readFileSync('public/fixtures/cropped-images.docx')), out = unzipSync(readFileSync(saved));
  expectBodyEditParts(out, original);
  await reopenDocx(page, input, saved, text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(count); await openProperties(page, input);
  await expect(page.getByLabel('Crop left (%)')).toHaveValue('50'); await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('1.5'); await expect(page.getByLabel('Keep image proportions')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await openProperties(page, input, 1); for (const side of ['left', 'top', 'right', 'bottom']) await expect(page.getByLabel(`Crop ${side} (%)`)).toHaveValue('-25');
  expect(errors).toEqual([]);
});

test('authors crop and transparent outsets with stable frame pixels, reset and undo/redo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  const png = unzipSync(readFileSync('public/fixtures/cropped-images.docx'))['word/media/image1.png'];
  await page.getByLabel('Insert image file').setInputFiles({ name: 'panels.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await expect(input).toHaveValue('\ufffc');
  await openProperties(page, input); await page.getByLabel('Image width (in)', { exact: true }).fill('1'); await page.getByLabel('Image alt text').fill('Cropped blue panel'); await apply(page); await input.press('ArrowRight');
  const full = await firstPicturePixels(page); expect(Math.abs(full.width - 96)).toBeLessThan(2); expect(Math.abs(full.height - 48)).toBeLessThan(2);
  await openProperties(page, input); await page.getByLabel('Crop right (%)').fill('50'); await page.getByLabel('Crop top (%)').fill('25'); await page.getByLabel('Crop bottom (%)').fill('25'); await apply(page); await input.press('ArrowRight');
  const blue = await firstPicturePixels(page); expect(blue.orange).toBe(0); expect(blue.blue).toBeGreaterThan(1000); expect(blue.width).toBe(full.width); expect(blue.height).toBe(full.height);
  await openProperties(page, input); await page.getByRole('button', { name: 'Reset crop', exact: true }).click(); await apply(page); await input.press('ArrowRight');
  expect(await firstPicturePixels(page)).toEqual(full);
  await openProperties(page, input); for (const side of ['left', 'top', 'right', 'bottom']) await page.getByLabel(`Crop ${side} (%)`).fill('-50');
  await apply(page); await input.press('ArrowRight'); const outset = await firstPicturePixels(page);
  expect(Math.abs(outset.width - 48)).toBeLessThan(2); expect(Math.abs(outset.height - 24)).toBeLessThan(2); expect(Math.abs(outset.x - full.x - 24)).toBeLessThan(2); expect(Math.abs(outset.y - full.y - 12)).toBeLessThan(2);
  await screenshot(page, testInfo, 0, 'outset-pixels.png');
  for (const name of ['Undo', 'Undo', 'Redo', 'Undo']) await page.getByRole('button', { name, exact: true }).click();
  await selectImage(input); await input.press('ArrowRight'); expect(await firstPicturePixels(page)).toEqual(blue);
  await page.keyboard.insertText(' after'); const saved = await download(page, testInfo, 'new-cropped-images.docx');
  await screenshot(page, testInfo, 0, 'new-cropped-pixels.png');
  await reopenDocx(page, input, saved, '\ufffc after'); await openProperties(page, input);
  await expect(page.getByLabel('Crop right (%)')).toHaveValue('50'); await expect(page.getByLabel('Crop top (%)')).toHaveValue('25'); await expect(page.getByLabel('Crop bottom (%)')).toHaveValue('25');
  expect(errors).toEqual([]);
});
