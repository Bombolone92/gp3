import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('edits imported vertical merges spanning pages and preserves styles, row keeps and DOCX parts', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/vertical-pages.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Merged cells can continue/);
  const select = (first, last = first) => input.evaluate((el, { first, last }) => { el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { first, last });
  const count = await page.locator('canvas.canvas-page').count(); expect(count).toBeGreaterThan(5);
  await select('Left end Á😀'); await input.press('ArrowLeft'); await input.press('ArrowUp');
  const at = await input.evaluate(el => el.selectionStart), textBefore = await input.inputValue();
  expect(at).toBeGreaterThan(textBefore.indexOf('Left merged text.')); expect(at).toBeLessThan(textBefore.indexOf('Left end Á😀'));
  await select('Left end Á😀'); await input.press('ArrowRight'); await page.keyboard.insertText(' revised');
  await select('Right end'); await (await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true }).click();
  await select('Left merged text.'); await (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Keep table row together', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select('Height only'); await input.press('ArrowRight'); await page.keyboard.insertText(' edited');
  for (const index of [0, 1, 2, count - 1]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(canvas => canvas.toDataURL());
    writeFileSync(testInfo.outputPath(`flowing-page-${index + 1}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('vertical-pages.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/vertical-pages.docx')), exported = unzipSync(readFileSync(saved));
  expectBodyEditParts(exported, original);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(count);
  await select('Right end'); await expect((await onTab(page, 'home')).getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect((await onTab(page, 'home')).getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true'); expect(errors).toEqual([]);
});

test('creates a long vertical merge, inserts a continuation row and saves editable pages', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click(); await page.getByRole('button', { name: 'Insert', exact: true }).click();
  for (const [i, text] of [('New merged line. ').repeat(160), 'Side top', 'Lower paragraph', 'Side bottom'].entries()) { if (i) await input.press('Tab'); await page.keyboard.insertText(text); }
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = text => input.evaluate((el, text) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
  await select('New merged line.'); await actions.selectOption('mergeBelow');
  await expect(input).toHaveValue(/Lower paragraph\nSide top/); expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  await actions.selectOption('splitCell'); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select('Side top'); await actions.selectOption('addRow'); await page.keyboard.insertText('Inserted row');
  await select('New merged line.'); await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 8))).toBe('Side top');
  await input.press('Tab'); expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionStart + 12))).toBe('Inserted row');
  const count = await page.locator('canvas.canvas-page').count(); expect(count).toBeGreaterThan(1);
  for (const index of [0, 1, count - 1]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(canvas => canvas.toDataURL());
    writeFileSync(testInfo.outputPath(`new-flowing-page-${index + 1}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-vertical-pages.docx'); await (await download).saveAs(saved);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(count); await select('Lower paragraph'); await expect(actions.locator('option[value="splitCell"]')).toBeEnabled();
  expect(errors).toEqual([]);
});
