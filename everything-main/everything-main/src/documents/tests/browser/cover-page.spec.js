import { test, expect } from '@playwright/test';
import { onTab, downloadDocx } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('Insert → Cover Page adds an editable title page before the document in one undo step', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByRole('button', { name: 'Two paragraphs', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = await input.inputValue();
  const pages = await page.locator('canvas.canvas-page').count();
  await (await onTab(page, 'insert')).locator('.ribbon-card').getByRole('button', { name: 'Cover Page', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Lined/ }).click();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(pages + 1);
  const value = await input.inputValue();
  expect(value.endsWith(original)).toBe(true);
  expect(value.startsWith('Two paragraphs\nDocument subtitle\nAuthor Name\n')).toBe(true);
  expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Two paragraphs');
  await page.keyboard.type('Quarterly Review');
  expect(await input.inputValue()).toMatch(/^Quarterly Review\n/);
  const path = info.outputPath('cover-page.docx');
  const download = page.waitForEvent('download'); await downloadDocx(page); await (await download).saveAs(path);
  await reopenDocx(page, input, path, await input.inputValue());
  await expect(page.locator('canvas.canvas-page')).toHaveCount(pages + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).isVisible();
  expect(errors).toEqual([]);
});
