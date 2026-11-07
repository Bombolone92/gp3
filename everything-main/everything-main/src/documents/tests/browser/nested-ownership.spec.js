import { test, expect } from '@playwright/test';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

for (const placement of ['left', 'right', 'lower']) test(`preserves nested cells through outer ${placement === 'lower' ? 'vertical merge and row deletion' : 'horizontal merge'} (${placement})`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(placement === 'left' ? 'tests/fixtures/nested-tables/nested-table-deep.docx' : `tests/fixtures/nested-tables/nested-ownership-${placement}-source.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const actions = page.getByRole('combobox', { name: 'Table actions', exact: true });
  await expect(input).toHaveValue(/Inner A1/);
  const original = await input.inputValue();
  const select = (first, last = first) => input.evaluate((el, { first, last }) => {
    el.setSelectionRange(el.value.indexOf(first), el.value.indexOf(last) + last.length);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { first, last });
  if (placement === 'lower') {
    await select('Outer lower left'); await actions.selectOption('mergeBelow');
    await select('Outer lower left'); await actions.selectOption('row');
    await expect(input).toHaveValue(/Inner A1/);
    await expect(input).not.toHaveValue(/Outer lower right/);
  } else {
    await select(placement === 'left' ? 'Outer before' : 'Outer side', placement === 'left' ? 'Outer side' : 'Outer after');
    await expect(actions.locator('option[value="mergeCells"]')).toBeEnabled();
    await actions.selectOption('mergeCells'); await expect(input).toHaveValue(original);
  }
  const result = await input.inputValue();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  if (placement === 'lower') await expect(input).toHaveValue(/Outer lower right/);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toHaveValue(result);
  await select('Inner A1'); await input.press('ArrowRight'); await page.keyboard.insertText(' edited');
  await expect(input).toHaveValue(/Inner A1 edited/);
  const text = await input.inputValue(), download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(`nested-ownership-${placement}.docx`); await (await download).saveAs(path);
  await reopenDocx(page, input, path, text);
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath(`nested-ownership-${placement}.png`) });
  expect(errors).toEqual([]);
});

for (const side of ['before', 'after']) test(`inserts editable parent-cell text ${side} a nested subtree`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('tests/fixtures/nested-tables/nested-table-deep.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Inner B1/);
  const original = await input.inputValue();
  await input.evaluate(el => { const at = el.value.indexOf('Inner B1'); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('combobox', { name: 'Table actions', exact: true }).selectOption(side);
  await page.keyboard.insertText(`Inserted ${side}`);
  const text = await input.inputValue();
  expect(text).toContain(side === 'before' ? 'Outer before\nInserted before\nDeep cell' : 'Inner B2\nInserted after\nOuter after');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toHaveValue(text);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(`nested-paragraph-${side}.docx`); await (await download).saveAs(path);
  await reopenDocx(page, input, path, text);
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath(`nested-paragraph-${side}.png`) });
  expect(errors).toEqual([]);
});
