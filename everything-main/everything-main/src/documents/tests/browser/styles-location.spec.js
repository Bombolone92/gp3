import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('edits and reopens a style stored outside the conventional location', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/styles-location.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Relationship based styles\nStyled cell/);
  await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('16');
  await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Style font size (pt)', exact: true }).fill('21');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('21');
  await page.locator('canvas.canvas-page').first().screenshot({ path: testInfo.outputPath('styles-location.png') });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('styles-location.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/styles-location.docx')), edited = unzipSync(readFileSync(saved));
  expect(Object.keys(edited).sort()).toEqual(Object.keys(original).sort());
  expect(strFromU8(edited['format/styles2.xml'])).toContain('w:val="42"');
  for (const name of Object.keys(original)) if (!['format/styles2.xml', 'word/document.xml'].includes(name)) expect(edited[name]).toEqual(original[name]);
  await reopenDocx(page, input, saved, await input.inputValue());
  await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('21');
  expect(errors).toEqual([]);
});
