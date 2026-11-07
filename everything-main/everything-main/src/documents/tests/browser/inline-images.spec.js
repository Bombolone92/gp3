import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const selectImage = (input, index = 0) => input.evaluate((el, index) => {
  const positions = [...el.value.matchAll(/\ufffc/g)].map(m => m.index), at = positions[index];
  el.setSelectionRange(at, at + 1); el.dispatchEvent(new Event('select', { bubbles: true }));
}, index);
const screenshot = async (page, testInfo, index, name) => {
  const png = await page.locator('canvas.canvas-page').nth(index).evaluate(canvas => canvas.toDataURL());
  writeFileSync(testInfo.outputPath(name), Buffer.from(png.split(',')[1], 'base64'));
};
async function properties(page, width, alt) {
  await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await page.getByLabel('Image width (in)', { exact: true }).fill(width);
  await page.getByLabel('Image alt text', { exact: true }).fill(alt);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('edits imported inline pictures, paints transparent and repeated copies, and preserves binary media on reopen', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/inline-images.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Inline pictures/);
  expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(6);
  const pixel = await page.locator('canvas.canvas-page').first().evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), ratio = canvas.width / parseFloat(canvas.style.width);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const at = (y * canvas.width + x) * 4; if (data[at] === 30 && data[at + 1] === 90 && data[at + 2] === 180) return { x: x / ratio + 4, y: y / ratio + 4 }; }
    throw new Error('The embedded picture was not painted.');
  });
  await page.locator('canvas.canvas-page').first().click({ position: pixel });
  expect(await input.evaluate(el => el.selectionEnd - el.selectionStart)).toBe(1);
  await properties(page, '1.5', 'Updated blue and orange panels');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await input.press('ArrowRight'); await page.keyboard.insertText(' edited'); await expect(input).toHaveValue(/Before \ufffc edited after\./);
  const count = await page.locator('canvas.canvas-page').count(); expect(count).toBeGreaterThan(2);
  for (const i of [0, 1, 2]) await screenshot(page, testInfo, i, `images-page-${i + 1}.png`);
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('inline-images.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/inline-images.docx')), out = unzipSync(readFileSync(saved));
  expectBodyEditParts(out, original);
  await reopenDocx(page, input, saved, text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(count); await selectImage(input); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('1.5'); await expect(page.getByLabel('Image height (in)', { exact: true })).toHaveValue('0.75');
  await expect(page.getByLabel('Image alt text')).toHaveValue('Updated blue and orange panels'); await expect(page.getByLabel('Keep image proportions')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('inserts PNG and JPEG pictures, resizes them beyond the writing area and restores deletion with undo and redo', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(''); await input.focus(); await page.keyboard.insertText('Start ');
  // Independent JPEG test pixels from the browser's own canvas encoder.
  const jpeg = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b02030'; ctx.fillRect(0, 0, 80, 40); return canvas.toDataURL('image/jpeg', .95).split(',')[1]; });
  await page.getByLabel('Insert image file').setInputFiles({ name: 'red-panel.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') }); await expect(input).toHaveValue('Start \ufffc');
  await properties(page, '2', 'Red panel');
  await page.getByRole('button', { name: 'Image properties', exact: true }).click(); await page.getByLabel('Image width (in)', { exact: true }).fill('20'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await input.press('ArrowRight'); await input.press('Enter'); await page.keyboard.insertText('Second ');
  const png = unzipSync(readFileSync('public/fixtures/inline-images.docx'))['word/media/image1.png'];
  await page.getByLabel('Insert image file').setInputFiles({ name: 'panels.png', mimeType: 'image/png', buffer: Buffer.from(png) }); await expect(input).toHaveValue('Start \ufffc\nSecond \ufffc');
  await properties(page, '1', 'Blue and orange panels'); await input.press('Backspace'); expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await input.inputValue()).match(/\ufffc/g)).toHaveLength(2); await input.press('ArrowRight'); await page.keyboard.insertText(' after.');
  await screenshot(page, testInfo, 0, 'new-images-page-1.png');
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-inline-images.docx'); await (await download).saveAs(saved);
  await reopenDocx(page, input, saved, text);
  await selectImage(input); await page.getByRole('button', { name: 'Image properties', exact: true }).click();
  await expect(page.getByLabel('Image width (in)', { exact: true })).toHaveValue('2'); await expect(page.getByLabel('Image alt text')).toHaveValue('Red panel'); expect(errors).toEqual([]);
});

test('previews an undecodable embedded bitmap as read-only with the original available', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page);
  const parts = unzipSync(readFileSync('public/fixtures/inline-images.docx')), png = parts['word/media/image1.png'];
  // Retain a valid IHDR and chunk lengths, but corrupt the compressed pixel data.
  png.fill(0, 41, png.length - 16);
  await openReadOnlyPreview(page, { name: 'broken-image.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});
