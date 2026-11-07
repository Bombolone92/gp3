import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { downloadDocx } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

test('typing invalidates saved checking, undo preserves source, and edited export reopens', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('tests/fixtures/proofing-state/proofing-clean.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue('jumpd');
  await input.press('ControlOrMeta+End'); await input.pressSequentially(' more');
  await expect(input).toHaveValue('jumpd more');
  const edited = info.outputPath('proofing-edited.docx'), pending = page.waitForEvent('download');
  await downloadDocx(page); await (await pending).saveAs(edited);
  expect(strFromU8(unzipSync(readFileSync(edited))['word/settings.xml'])).toMatch(/spelling="dirty".*grammar="dirty"/);
  // Restore all five separately typed characters through the editor's undo history.
  for (let i = 0; i < 5; i++) await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('jumpd');
  const undo = info.outputPath('proofing-undo.docx'), undonePending = page.waitForEvent('download');
  await downloadDocx(page); await (await undonePending).saveAs(undo);
  expect(unzipSync(readFileSync(undo))).toEqual(unzipSync(readFileSync('tests/fixtures/proofing-state/proofing-clean.docx')));
  await reopenDocx(page, input, edited, 'jumpd more'); expect(errors).toEqual([]);
});
