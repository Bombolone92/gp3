import { showAllTools, onTab } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('edits imported merged cells, merges and splits text, resizes grid columns and reopens preserved DOCX', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/merged-cells.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = (first, last = first) => input.evaluate((el, { first, last }) => { el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { first, last });
  await expect(input).toHaveValue(/^Cells can span/);
  await page.locator('canvas.canvas-page').first().click({ position: { x: 130, y: 79 } });
  await input.press('ArrowDown');
  expect(await input.evaluate(el => { const before = el.value.slice(0, el.selectionStart); return before.slice(before.lastIndexOf('\n') + 1); })).toBe('L');
  await select('Wide heading'); await input.press('ArrowRight'); await page.keyboard.insertText(' revised');
  await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 4))).toBe('Side');
  await input.press('Shift+Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 4))).toBe('Wide');
  await select('Middle'); await (await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true }).click();
  await select('Left', 'Right'); const before = await input.inputValue();
  await expect(actions).toBeEnabled();
  // Playwright follows an option's enclosing label to the select when checking
  // enabled/disabled. Check each native option's own state instead.
  await expect(actions.locator('option[value="mergeCells"]')).toHaveJSProperty('disabled', false);
  await actions.selectOption('mergeCells'); await expect(input).toHaveValue(before);
  await expect(actions.locator('option[value="splitCell"]')).toHaveJSProperty('disabled', false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(actions.locator('option[value="splitCell"]')).toHaveJSProperty('disabled', true);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await actions.selectOption('splitCell');
  await input.press('Tab'); await page.keyboard.insertText('Split middle'); await input.press('Tab'); await page.keyboard.insertText('Split right');
  await select('Split middle', 'Split right'); await actions.selectOption('mergeCells');
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Table properties', exact: true }).click();
  await expect(page.getByLabel('Table column', { exact: true }).locator('option')).toHaveCount(3);
  await page.getByLabel('Table column', { exact: true }).selectOption({ value: '2' }); await page.getByLabel('Column width (in)', { exact: true }).fill('22');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByLabel('Column width (in)', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await select('Wide heading revised');
  await page.screenshot({ path: testInfo.outputPath('merged-toolbar.png'), animations: 'disabled' });
  await page.locator('canvas.canvas-page').first().screenshot({ path: testInfo.outputPath('merged-first-page.png'), animations: 'disabled' });
  await page.locator('canvas.canvas-page').nth(1).screenshot({ path: testInfo.outputPath('merged-row-continuation.png'), animations: 'disabled' });
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('merged-cells.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/merged-cells.docx')), exported = unzipSync(readFileSync(saved));
  expectBodyEditParts(exported, original);
  await reopenDocx(page, input, saved, text);
  await select('Middle'); await expect((await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect((await onTab(page, 'home')).getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await select('Split right'); await expect(actions.locator('option[value="splitCell"]')).toHaveJSProperty('disabled', false);
  expect(errors).toEqual([]);
});

test('creates merged cells and retains spans through column and row operations and AutoFit save/reopen', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click(); await page.getByLabel('Table columns', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  for (const [i, text] of ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].entries()) { if (i) await input.press('Tab'); await page.keyboard.insertText(text); }
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = (first, last = first) => input.evaluate((el, { first, last }) => { el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { first, last });
  await select('One', 'Three'); await actions.selectOption('mergeCells'); await actions.selectOption('splitCell');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select('Four'); await actions.selectOption('addColumn'); await page.keyboard.insertText('Inserted');
  await actions.selectOption('column'); await expect(input).not.toHaveValue(/Inserted/);
  await select('One'); await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 4))).toBe('Four');
  await select('One'); await actions.selectOption('addRow'); await page.keyboard.insertText('New merged row');
  await actions.selectOption('fitContents');
  await page.screenshot({ path: testInfo.outputPath('new-merged-cells.png'), animations: 'disabled' });
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-merged-cells.docx'); await (await download).saveAs(saved);
  await reopenDocx(page, input, saved, text);
  await select('New merged row'); await expect(actions.locator('option[value="splitCell"]')).toBeEnabled();
  await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Table properties', exact: true }).click();
  await expect(page.getByLabel('Table layout', { exact: true })).toHaveValue('autofit');
  await expect(page.getByLabel('Table column', { exact: true }).locator('option')).toHaveCount(3);
  expect(errors).toEqual([]);
});
