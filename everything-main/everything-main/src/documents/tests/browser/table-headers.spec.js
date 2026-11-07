import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('edits a repeated header copy on its page and preserves inherited header flags and DOCX content', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/table-headers.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Repeated table headers/);
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(3);
  // The text starts at x=48; x=56 is past the first glyph midpoint with Noto Sans.
  await page.locator('canvas.canvas-page').nth(1).click({ position: { x: 49, y: 57 } });
  expect(await input.evaluate(el => el.selectionStart)).toBe((await input.inputValue()).indexOf('Product'));
  await page.keyboard.insertText('New '); await expect(input).toHaveValue(/New Product Á😀/); expect((await input.inputValue()).match(/Product/g)).toHaveLength(1);
  const caretOnCopy = () => input.evaluate(el => el.getBoundingClientRect().top - document.querySelectorAll('canvas.canvas-page')[1].getBoundingClientRect().top);
  expect(await caretOnCopy()).toBeGreaterThan(40); expect(await caretOnCopy()).toBeLessThan(100);
  await input.press('ArrowRight'); expect(await caretOnCopy()).toBeLessThan(100);
  const select = text => input.evaluate((el, text) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
  await select('Description'); await (await onTab(page, 'home')).getByRole('button', { name: 'Underline', exact: true }).click();
  await select('Details'); await actions.selectOption('addRow'); await page.keyboard.insertText('Extra header');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  for (const index of [0, 1, 2]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(canvas => canvas.toDataURL()); writeFileSync(testInfo.outputPath(`header-page-${index + 1}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  const text = await input.inputValue(), count = await page.locator('canvas.canvas-page').count(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('table-headers.docx'); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/table-headers.docx')), exported = unzipSync(readFileSync(saved));
  expectBodyEditParts(exported, original);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  expect(await page.locator('canvas.canvas-page').count()).toBe(count); await select('Description'); await expect((await onTab(page, 'home')).getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(actions.locator('option[value="clearHeader"]')).toBeEnabled(); expect(errors).toEqual([]);
});

test('authors repeated headers, merges header cells and inserts a body row at their boundary', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click(); await page.getByLabel('Table rows', { exact: true }).fill('4'); await page.getByRole('button', { name: 'Insert', exact: true }).click();
  for (const [i, text] of ['Header', 'Value', 'One', 'Long body content. '.repeat(100), 'Two', 'Last body. '.repeat(20), 'Three', 'End'].entries()) { if (i) await input.press('Tab'); await page.keyboard.insertText(text); }
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  const select = (first, last = first) => input.evaluate((el, { first, last }) => { el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { first, last });
  await select('Header'); await actions.selectOption('repeatHeader'); await actions.selectOption('repeatHeader'); await actions.selectOption('clearHeader');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(actions.locator('option[value="clearHeader"]')).toBeEnabled();
  await select('Header', 'Value'); await actions.selectOption('mergeCells'); await actions.selectOption('addRow'); await page.keyboard.insertText('Inserted body');
  expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  for (const index of [0, 1]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(canvas => canvas.toDataURL()); writeFileSync(testInfo.outputPath(`new-header-page-${index + 1}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  const text = await input.inputValue(), download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-table-headers.docx'); await (await download).saveAs(saved);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  await select('Header'); await expect(actions.locator('option[value="clearHeader"]')).toBeEnabled(); expect((await input.inputValue()).match(/Header/g)).toHaveLength(1); expect(errors).toEqual([]);
});
