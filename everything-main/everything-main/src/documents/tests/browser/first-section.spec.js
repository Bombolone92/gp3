import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test('opens, edits, undoes and reopens a first continuous section without a leading page', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/first-section.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue('First section origin\nCafé and Unicode 😀');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await expect(page.locator('#playground-error')).toBeEmpty();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue('First section origin\nCafé and Unicode 😀');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.locator('canvas.canvas-page').screenshot({ path: info.outputPath('first-section.png') });
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = info.outputPath('first-section.docx'); await (await pending).saveAs(saved);
  const before = unzipSync(readFileSync('public/fixtures/first-section.docx')), after = unzipSync(readFileSync(saved));
  for (const name of Object.keys(before)) if (name !== 'word/document.xml') expect(after[name]).toEqual(before[name]);
  expect(strFromU8(after['word/document.xml'])).toContain('w:val="continuous"');
  await reopenDocx(page, input, saved, 'Edited First section origin\nCafé and Unicode 😀');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1); expect(errors).toEqual([]);
});
