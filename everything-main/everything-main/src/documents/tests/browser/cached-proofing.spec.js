import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { downloadDocx, onTab } from './helpers/editor-tools.js';

const cases = JSON.parse(readFileSync('tests/fixtures/cached-proofing/cases.json'));
const proofing = page => page.locator('.ed-proofing');
const pixelHash = page => page.locator('canvas.canvas-page').first().evaluate(async c => {
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
});
async function open(page, path) {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(path);
  return page.getByRole('textbox', { name: 'Document text' });
}
for (const name of cases) test(`${name}: automatic spelling agrees with the native saved-range control`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, `tests/fixtures/cached-proofing/${name}.docx`);
  const native = JSON.parse(readFileSync(`tests/fixtures/cached-proofing/${name}-native.json`, 'utf8').replace(/^\uFEFF/, ''));
  await expect(proofing(page)).toHaveAttribute('aria-label', native.errors.length ? new RegExp(`${native.errors.length} errors? found`) : 'Spelling: no errors');
  expect(errors).toEqual([]);
});

test('text edits invalidate the clean cache and undo restores its pixels and source', async ({ page }, info) => {
  const source = 'tests/fixtures/proofing-state/proofing-clean.docx';
  const input = await open(page, source);
  await expect(proofing(page)).toHaveAttribute('aria-label', 'Spelling: no errors');
  await input.press('ControlOrMeta+Home');
  const initialPixels = await pixelHash(page);
  await input.press('ControlOrMeta+End'); await input.pressSequentially(' more');
  await expect(proofing(page)).toHaveAttribute('aria-label', /1 error found/);
  for (let i = 0; i < 5; i++) await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('jumpd');
  await expect(proofing(page)).toHaveAttribute('aria-label', 'Spelling: no errors');
  await input.press('ControlOrMeta+Home');
  expect(await pixelHash(page)).toBe(initialPixels);
  const path = info.outputPath('cache-undo.docx'), pending = page.waitForEvent('download');
  await downloadDocx(page); await (await pending).saveAs(path);
  expect(unzipSync(readFileSync(path))).toEqual(unzipSync(readFileSync(source)));
});

test('formatting retains the cache while explicit F7 and Recheck Document check all words', async ({ page }) => {
  const input = await open(page, 'tests/fixtures/proofing-state/proofing-clean.docx');
  await expect(proofing(page)).toHaveAttribute('aria-label', 'Spelling: no errors');
  await input.press('ControlOrMeta+a'); await input.press('ControlOrMeta+b');
  await expect(proofing(page)).toHaveAttribute('aria-label', 'Spelling: no errors');
  await input.press('F7');
  await expect(page.getByRole('complementary', { name: 'Spelling' }).locator('mark')).toHaveText('jumpd');
  await expect(proofing(page)).toHaveAttribute('aria-label', /1 error found/);
  await page.getByRole('button', { name: 'Close Spelling pane' }).click();
  page.once('dialog', dialog => dialog.accept());
  await open(page, 'tests/fixtures/proofing-state/proofing-clean.docx');
  await expect(proofing(page)).toHaveAttribute('aria-label', 'Spelling: no errors');
  await onTab(page, 'review'); await page.getByRole('button', { name: 'Spelling options' }).click();
  await page.getByRole('menuitem', { name: 'Recheck Document', exact: true }).click();
  await expect(proofing(page)).toHaveAttribute('aria-label', /1 error found/);
});
