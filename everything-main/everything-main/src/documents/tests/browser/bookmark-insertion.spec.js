import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

const reference = JSON.parse(readFileSync('tests/fixtures/bookmark-insertion/native-ranges.json', 'utf8'));
async function download(page, info, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(name); await (await pending).saveAs(path); return path;
}
async function bookmarkSelection(page, input, name, expected) {
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Bookmarks', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Document bookmarks', exact: true });
  const id = await list.locator('option').filter({ hasText: new RegExp('^' + name + ' ·') }).getAttribute('value');
  await list.selectOption(id);
  await page.getByRole('dialog').getByRole('button', { name: 'Go to bookmark', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(input).toBeFocused();
  // Navigation places the caret at the start; exported XML verifies both endpoints.
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([expected.start, expected.start]);
}

for (const mode of ['append-row', 'middle-row', 'append-column', 'middle-column']) {
  test(`preserves native bookmark positions through ${mode} in the editor`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/playground.html'); await showAllTools(page);
    await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/bookmark-insertion.docx');
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(reference.cases.original.text.slice(0, -1));
    const rowEdit = mode.endsWith('row'), append = mode.startsWith('append');
    const label = rowEdit ? append ? 'A2' : 'A1' : append ? 'B1' : 'A1';
    await input.evaluate((el, label) => { const at = el.value.indexOf(label); el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }, label);
    await page.getByRole('combobox', { name: 'Table actions', exact: true }).selectOption(rowEdit ? 'addRow' : 'addColumn');
    await page.keyboard.insertText(rowEdit ? 'New L' : 'New top');
    for (let i = 0; i < (rowEdit ? 1 : 3); i++) await input.press('Tab');
    await page.keyboard.insertText(rowEdit ? 'New R' : 'New bottom');
    const expected = reference.cases[mode];
    await expect(input).toHaveValue(expected.text.slice(0, -1));
    const changed = rowEdit ? append ? 'RowTwo' : 'RowOne' : append ? 'CellTwo' : 'CellOne';
    const point = append ? 'AfterRows' : rowEdit ? 'BetweenRows' : 'BetweenCells';
    for (const name of [changed, point, 'WholeTable']) await bookmarkSelection(page, input, name, expected.bookmarks[name]);
    const saved = await download(page, info, `bookmark-insertion-${mode}.docx`);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(input).toHaveValue(reference.cases.original.text.slice(0, -1));
    const restored = unzipSync(readFileSync(await download(page, info, `bookmark-insertion-${mode}-undo.docx`)));
    for (const [name, bytes] of Object.entries(unzipSync(readFileSync('public/fixtures/bookmark-insertion.docx')))) expect(Buffer.from(restored[name]).equals(Buffer.from(bytes)), name).toBe(true);
    await reopenDocx(page, input, saved, expected.text.slice(0, -1));
    for (const name of [changed, point, 'WholeTable']) await bookmarkSelection(page, input, name, expected.bookmarks[name]);
    expect(errors).toEqual([]);
  });
}
