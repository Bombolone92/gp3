import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('edits vertical cells, retains text through row deletion and reopens preserved DOCX', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/vertical-cells.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = (text, end = false) => input.evaluate((el, { text, end }) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at + (end ? text.length : 0)); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, end });
  await expect(input).toHaveValue(/^Vertical cells/);
  await page.locator('canvas.canvas-page').first().screenshot({ path: testInfo.outputPath('vertical-first-page.png'), animations: 'disabled' });
  await page.locator('canvas.canvas-page').nth(1).screenshot({ path: testInfo.outputPath('vertical-second-page.png'), animations: 'disabled' });
  await select('Top'); await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 2))).toBe('B0');
  await input.press('Tab'); await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 2))).toBe('B1');
  await select('Top', true); await input.press('ArrowRight'); await page.keyboard.insertText(' revised');
  await select('Top revised'); await actions.selectOption('row'); await expect(input).not.toHaveValue(/B0/); await expect(input).toHaveValue(/Top revised\n\nSecond Á😀/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(/B0/);
  await select('F0'); await expect(actions.locator('option[value="mergeBelow"]')).toBeEnabled(); await actions.selectOption('mergeBelow');
  await expect(input).toHaveValue(/F0\nG0\nF1/); await actions.selectOption('splitCell');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select('F0', true); await (await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true }).click();
  await select('Top revised'); await page.screenshot({ path: testInfo.outputPath('vertical-toolbar.png'), animations: 'disabled' });
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('vertical-cells.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/vertical-cells.docx')), exported = unzipSync(readFileSync(saved));
  expectBodyEditParts(exported, original);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  await select('Top revised'); await expect((await onTab(page, 'home')).getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await select('F0', true); await expect((await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(actions.locator('option[value="splitCell"]')).toBeEnabled(); expect(errors).toEqual([]);
});

test('creates vertical merges, extends rows, splits a rectangle and keeps AutoFit exports editable', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click(); await page.getByLabel('Table rows', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  for (const [i, text] of ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].entries()) { if (i) await input.press('Tab'); await page.keyboard.insertText(text); }
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = (first, last = first) => input.evaluate((el, { first, last }) => { el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { first, last });
  await select('One'); await actions.selectOption('mergeBelow');
  await select('Two'); await actions.selectOption('addRow'); await page.keyboard.insertText('Inserted side');
  await select('One'); await actions.selectOption('splitCell'); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select('Five', 'Six'); await actions.selectOption('mergeCells');
  await actions.selectOption('addRow'); await page.keyboard.insertText('Last row');
  await select('Five'); await actions.selectOption('mergeBelow');
  await actions.selectOption('splitCell'); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await actions.selectOption('fitContents');
  await page.screenshot({ path: testInfo.outputPath('new-vertical-cells.png'), animations: 'disabled' });
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-vertical-cells.docx'); await (await download).saveAs(saved);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  await select('One'); await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 3))).toBe('Two');
  await select('Last row'); await expect(actions.locator('option[value="splitCell"]')).toBeEnabled();
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Table properties', exact: true }).click(); await expect(page.getByLabel('Table layout', { exact: true })).toHaveValue('autofit');
  expect(errors).toEqual([]);
});

test('opens vertical groups and minimum row heights taller than a page for editing', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/vertical-cells.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll('w:val="864"', 'w:val="6000"'));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles({ name: 'tall-vertical.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/^Vertical cells/);
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(4);
  await expect(page.getByRole('button', { name: 'Download .docx', exact: true })).toBeEnabled();
  await expect(page.locator('.editor-error')).toHaveCount(0);
});
