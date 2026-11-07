import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools, onTab } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function select(input, first, last = first, caret = false) {
  await input.evaluate((el, { first, last, caret }) => {
    const at = el.value.indexOf(first), end = el.value.indexOf(last) + last.length;
    if (at < 0 || end < last.length) throw new Error('Missing cell text');
    el.setSelectionRange(at, caret ? at : end); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { first, last, caret });
}
async function open(page) {
  const button = (await onTab(page, 'tableLayout')).getByRole('button', { name: 'Cell margins', exact: true }); await button.focus(); await button.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cell margins', exact: true }); await expect(dialog).toBeVisible(); return dialog;
}
async function apply(page, sides = {}, preset) {
  const dialog = await open(page);
  if (preset) await dialog.getByRole('button', { name: preset, exact: true }).click();
  for (const [side, value] of Object.entries(sides)) {
    if (value === null) await dialog.getByRole('combobox', { name: `${side} cell margin setting`, exact: true }).selectOption('inherit');
    else await dialog.getByLabel(`${side} cell margin (pt)`, { exact: true }).fill(String(value));
  }
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function fixture(page) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/cell-margins.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Cell margins/); return input;
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}

test('edits inherited and logical margins, merged owners and repeated headers and reopens its independent DOCX', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const input = await fixture(page), text = await input.inputValue();
  await select(input, 'Inherited padding');
  await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Cell margins', exact: true }).locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await select(input, 'Inherited padding'); const before = await input.evaluate(el => [parseFloat(el.style.left), parseFloat(el.style.top)]);
  await apply(page, { Top: 9, Left: 15 }); const after = await input.evaluate(el => [parseFloat(el.style.left), parseFloat(el.style.top)]);
  // The resolved legacy table indent anchors the first cell's writing edge;
  // changing its leading margin moves the grid, not this text (native origins).
  expect(after[0] - before[0]).toBeCloseTo(0);
  const applied = await open(page);
  await expect(applied.getByLabel('Left cell margin (pt)', { exact: true })).toHaveValue('15');
  await applied.getByRole('button', { name: 'Cancel', exact: true }).click();
  // The neighboring cell's 12pt top margin still determines this physical row.
  expect(after[1] - before[1]).toBeCloseTo(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await input.evaluate(el => [parseFloat(el.style.left), parseFloat(el.style.top)])).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await select(input, 'Logical padding'); await apply(page, {}, 'Inherit all');
  await select(input, 'Ignored padding'); await apply(page, { Left: 0 });
  await select(input, 'Vertical margin'); await apply(page, { Left: 18 });
  await select(input, 'Header padding'); await apply(page, { Top: 12, Bottom: 9 });
  await expect(input).toHaveValue(text); const count = await page.locator('canvas.canvas-page').count(); expect(count).toBeGreaterThan(3);
  const saved = await download(page, testInfo, 'cell-margins.docx'); await reopenDocx(page, input, saved, text);
  await select(input, 'Logical padding'); const dialog = await open(page);
  await expect(dialog.getByLabel('Left cell margin (pt)', { exact: true })).toHaveValue('18');
  await expect(dialog.getByLabel('Top cell margin (pt)', { exact: true })).toHaveValue('3');
  await page.screenshot({ path: testInfo.outputPath('cell-margins-dialog.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await select(input, 'Tail', 'Tail', true);
  for (const index of [0, 1, count - 1]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL().split(',')[1]);
    writeFileSync(testInfo.outputPath(`cell-margins-page-${index + 1}.png`), Buffer.from(png, 'base64'));
  }
  expect(errors).toEqual([]);
});

test('authors four independent margins and zero padding in a new document with save and reopen', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await expect(page.locator('.ribbon-card').getByRole('button', { name: 'Cell margins', exact: true, includeHidden: true })).toBeDisabled();
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click();
  await page.getByLabel('Table rows', { exact: true }).fill('1'); await page.getByLabel('Table columns', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.keyboard.insertText('New padding'); await input.press('Tab'); await page.keyboard.insertText('New zero');
  await select(input, 'New padding'); await apply(page, { Top: 6, Left: 12, Bottom: 9, Right: 15 });
  await select(input, 'New zero'); await apply(page, {}, 'No padding');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-cell-margins.docx'); await reopenDocx(page, input, saved, text);
  await select(input, 'New zero'); const dialog = await open(page);
  for (const side of ['Top', 'Left', 'Bottom', 'Right']) await expect(dialog.getByLabel(`${side} cell margin (pt)`, { exact: true })).toHaveValue('0');
});

test('preserves mixed values, rolls back margins that cannot fit and keeps Unicode carets editable after reflow', async ({ page }) => {
  const input = await fixture(page), text = await input.inputValue(); await select(input, 'Inherited padding', 'Logical padding');
  await expect((await onTab(page, 'tableLayout')).getByRole('button', { name: 'Cell margins', exact: true })).toHaveAttribute('title', 'Cell margins: Mixed');
  let dialog = await open(page); await expect(dialog.getByLabel('Top cell margin (pt)', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await apply(page, {}, 'No padding'); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await select(input, 'Unicode Á😀', 'Unicode Á😀', true); const count = await page.locator('canvas.canvas-page').count();
  dialog = await open(page); await dialog.getByLabel('Left cell margin (pt)', { exact: true }).fill('1584'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('too little room'); await expect(input).toHaveValue(text); expect(await page.locator('canvas.canvas-page').count()).toBe(count);
  await dialog.getByLabel('Left cell margin (pt)', { exact: true }).fill('21');
  await dialog.getByLabel('Top cell margin (pt)', { exact: true }).fill('1584'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('too little room'); await expect(input).toHaveValue(text); expect(await page.locator('canvas.canvas-page').count()).toBe(count);
  await dialog.getByLabel('Top cell margin (pt)', { exact: true }).fill('3'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5');
  const position = await input.evaluate(el => { const c = document.querySelector('canvas.canvas-page').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - c.left, y: r.top - c.top }; });
  await page.locator('canvas.canvas-page').first().click({ position: { x: position.x + 1, y: position.y + 2 } });
  expect(await input.evaluate(el => el.selectionStart)).toBe(text.indexOf('Unicode Á😀'));
  await page.keyboard.insertText('Edited '); await expect(input).toHaveValue(/Edited Unicode Á😀/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(text);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); dialog = await open(page);
  await expect(dialog.getByLabel('Left cell margin (pt)', { exact: true })).toHaveValue('18');
});

test('keeps fields and Apply reachable on a short narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 500 }); const input = await fixture(page); await select(input, 'Inherited padding');
  const dialog = await open(page), apply = dialog.getByRole('button', { name: 'Apply', exact: true }); await expect(apply).toBeInViewport();
  const field = dialog.getByLabel('Right cell margin (pt)', { exact: true }); await field.focus(); await expect(field).toBeInViewport(); await field.fill('12'); await expect(apply).toBeInViewport();
  await dialog.screenshot({ path: testInfo.outputPath('cell-margins-narrow.png'), animations: 'disabled' });
  await apply.click(); await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
});

test('previews malformed margin markup as read-only with the original available', async ({ page }) => {
  const input = await fixture(page), text = await input.inputValue(), parts = unzipSync(readFileSync('public/fixtures/cell-margins.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:start w:w="540" w:type="dxa"/>', '<w:start w:w="-1"/>'));
  await openReadOnlyPreview(page, { name: 'invalid-margins.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

  await expect(page.getByRole('button', { name: 'Download .docx', exact: true })).toBeEnabled();
});
