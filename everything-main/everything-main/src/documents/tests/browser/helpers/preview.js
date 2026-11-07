import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { downloadDocx } from './editor-tools.js';

export async function openReadOnlyPreview(page, file) {
  const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(file);
  if (previous) await expect.poll(() => previous.evaluate(el => el.isConnected)).toBe(false);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveJSProperty('readOnly', true);
  const error = page.locator('#playground-error');
  if (await error.count()) await expect(error).toBeEmpty();
  await expect(page.locator('.canvas-message-error')).toHaveCount(0);
  await expect(page.locator('canvas.canvas-page').first()).toBeVisible();
  expect((await input.inputValue()).length).toBeGreaterThan(0);
  const download = page.waitForEvent('download');
  await downloadDocx(page);
  expect(readFileSync(await (await download).path())).toEqual(typeof file === 'string' ? readFileSync(file) : file.buffer);
}
