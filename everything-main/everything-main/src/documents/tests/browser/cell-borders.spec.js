import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools, expectTableCommandUnavailable, onTab } from './helpers/editor-tools.js';
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
  const button = (await onTab(page, 'tableDesign')).getByRole('button', { name: 'Cell borders', exact: true }); await button.focus(); await button.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cell borders', exact: true }); await expect(dialog).toBeVisible(); return dialog;
}
async function apply(page, sides = {}, preset) {
  const dialog = await open(page);
  if (preset) await dialog.getByRole('button', { name: preset, exact: true }).click();
  for (const [side, [style, width, color]] of Object.entries(sides)) {
    await dialog.getByRole('combobox', { name: `${side} cell border style`, exact: true }).selectOption(style);
    if (width !== undefined) await dialog.getByLabel(`${side} cell border width (pt)`, { exact: true }).fill(String(width));
    if (color !== undefined) await dialog.getByLabel(`${side} cell border color`, { exact: true }).fill(color);
  }
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
async function fixture(page) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/cell-borders.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Cell borders/); return input;
}
async function pixels(page, hex, index = 0, opaque = false) {
  return page.locator('canvas.canvas-page').nth(index).evaluate((canvas, { hex, opaque }) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = hex.match(/../g).map(v => parseInt(v, 16)); let count = 0;
    // Thin strokes can cover only part of a pixel. Match the border's color
    // composited over white, while excluding near-white and gray text pixels.
    const axis = rgb.indexOf(Math.min(...rgb));
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (255 - data[i + axis]) / (255 - rgb[axis]);
      if (alpha >= (opaque ? .99 : .25) && alpha <= 1.01 && rgb.every((v, j) => Math.abs(data[i + j] - (255 + alpha * (v - 255))) <= 3)) count++;
    }
    return count;
  }, { hex, opaque });
}

test('paints an opposing visible border and removes it when both sides become nil', async ({ page }) => {
  const input = await fixture(page);
  expect(await pixels(page, 'CC3300', 0, true)).toBeGreaterThan(40);
  await select(input, 'Heavy single'); await apply(page, { Left: ['nil'] });
  expect(await pixels(page, 'CC3300', 0, true)).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await pixels(page, 'CC3300', 0, true)).toBeGreaterThan(40);
});

test('paints shared and merged borders, edits inherited sides and repeated headers, and reopens its independent DOCX', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const input = await fixture(page), text = await input.inputValue(), count = await page.locator('canvas.canvas-page').count();
  await expectTableCommandUnavailable(page, 'Cell borders'); await select(input, 'Inherited edges');
  const button = (await onTab(page, 'tableDesign')).getByRole('button', { name: 'Cell borders', exact: true }); await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  for (const hex of ['993366', '224466', 'F79646']) expect(await pixels(page, hex), hex).toBeGreaterThan(10);
  expect(await pixels(page, '668899', 0, true)).toBe(0); // Table-wide style tcBorders are ignored, as existing documents expect.
  // The 4 pt opposing single edge wins over nil. Count its opaque interior
  // rather than similarly colored antialiased emoji pixels.
  expect(await pixels(page, 'CC3300', 0, true)).toBeGreaterThan(40);
  await select(input, 'Inherited edges'); const before = await input.evaluate(el => [el.style.top, el.style.left]);
  await apply(page, { Top: ['double', 2, 'AABBCC'] }); expect(await input.evaluate(el => [el.style.top, el.style.left])).toEqual(before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); let dialog = await open(page);
  await expect(dialog.getByRole('combobox', { name: 'Top cell border style', exact: true })).toHaveValue('double');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await select(input, 'Direct edges'); await apply(page, {}, 'Inherit all');
  await select(input, 'Heavy single'); await apply(page, { Right: ['nil'] });
  await select(input, 'Vertical edges'); await apply(page, { Bottom: ['double', 2, 'CC3300'] });
  await select(input, 'Header edges'); await apply(page, { Bottom: ['triple', 2, '8855CC'] });
  await select(input, 'Tail', 'Tail', true); let repeats = 0;
  // The thicker compound header border takes real row space on every page.
  const finalCount = await page.locator('canvas.canvas-page').count(); expect(finalCount).toBeGreaterThan(count);
  for (let index = 1; index < finalCount; index++) if (await pixels(page, '8855CC', index) > 20) repeats++;
  expect(repeats).toBeGreaterThan(1); await expect(input).toHaveValue(text);
  const saved = await download(page, testInfo, 'cell-borders.docx'); await reopenDocx(page, input, saved, text);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(finalCount);
  await select(input, 'Direct edges'); dialog = await open(page);
  await expect(dialog.getByRole('combobox', { name: 'Left cell border style', exact: true })).toHaveValue('single');
  await expect(dialog.getByRole('combobox', { name: 'Top cell border style', exact: true })).toHaveValue('double');
  await page.screenshot({ path: testInfo.outputPath('cell-borders-dialog.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await select(input, 'Tail', 'Tail', true);
  for (const index of [0, 1, finalCount - 1]) {
    const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL().split(',')[1]);
    writeFileSync(testInfo.outputPath(`cell-borders-page-${index + 1}.png`), Buffer.from(png, 'base64'));
  }
  expect(errors).toEqual([]);
});

test('authors boxes and explicit border suppression in a new document and keeps them editable after reopening', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await expectTableCommandUnavailable(page, 'Cell borders');
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click();
  await page.getByLabel('Table rows', { exact: true }).fill('1'); await page.getByLabel('Table columns', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.keyboard.insertText('New box'); await input.press('Tab'); await page.keyboard.insertText('New clear');
  await select(input, 'New box'); await apply(page, {}, 'Box each cell');
  await select(input, 'New clear'); await apply(page, {}, 'No borders');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-cell-borders.docx'); await reopenDocx(page, input, saved, text);
  for (const [label, title] of [['New box', 'Custom'], ['New clear', 'None']]) {
    await select(input, label); await expect((await onTab(page, 'tableDesign')).getByRole('button', { name: 'Cell borders', exact: true })).toHaveAttribute('title', 'Cell borders: ' + title);
  }
});

test('preserves mixed sides on dismissal, clears mixed widths and keeps Unicode editing and zoomed carets stable', async ({ page }) => {
  const input = await fixture(page), text = await input.inputValue(); await select(input, 'Inherited edges', 'None inherits');
  const button = (await onTab(page, 'tableDesign')).getByRole('button', { name: 'Cell borders', exact: true }); await expect(button).toHaveAttribute('title', 'Cell borders: Mixed');
  let dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Top cell border style', exact: true })).toHaveValue('double');
  await expect(dialog.getByLabel('Top cell border width (pt)', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  await apply(page, { Top: ['nil'] }); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Top cell border style', exact: true })).toHaveValue('nil');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await apply(page, {}, 'No borders'); await expect(button).toHaveAttribute('title', 'Cell borders: None');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(button).toHaveAttribute('title', 'Cell borders: Mixed');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5');
  await select(input, 'Theme Á😀', 'Theme Á😀', true); await apply(page, { Top: ['double', 2, '4A76A8'] });
  const position = await input.evaluate(el => { const c = document.querySelector('canvas.canvas-page').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - c.left, y: r.top - c.top }; });
  await page.locator('canvas.canvas-page').first().click({ position: { x: position.x + 1, y: position.y + 2 } });
  expect(await input.evaluate(el => el.selectionStart)).toBe(text.indexOf('Theme Á😀'));
  await page.keyboard.insertText('Edited '); await expect(input).toHaveValue(/Edited Theme Á😀/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(text);
});

test('keeps border fields and actions reachable in a short narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const input = await fixture(page); await select(input, 'Inherited edges');
  const dialog = await open(page), apply = dialog.getByRole('button', { name: 'Apply', exact: true });
  await expect(apply).toBeInViewport();
  const style = dialog.getByRole('combobox', { name: 'Right cell border style', exact: true });
  await style.focus(); await expect(style).toBeInViewport(); await style.selectOption('double');
  const color = dialog.getByLabel('Right cell border color', { exact: true });
  await color.focus(); await expect(color).toBeInViewport(); await color.fill('8855CC');
  await expect(apply).toBeInViewport();
  await dialog.screenshot({ path: testInfo.outputPath('cell-borders-narrow.png'), animations: 'disabled' });
  await apply.click(); await expect(dialog).toHaveCount(0); await expect(input).toBeFocused();
  const reopened = await open(page); await expect(reopened.getByLabel('Right cell border color', { exact: true })).toHaveValue('8855CC');
});

test('previews unsupported border patterns as read-only with the original available', async ({ page }) => {
  const input = await fixture(page), text = await input.inputValue(), parts = unzipSync(readFileSync('public/fixtures/cell-borders.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:right w:val="nil" w:sz="8" w:color="224466"/>', '<w:right w:val="wave" w:sz="8"/>'));
  await openReadOnlyPreview(page, { name: 'unsupported-borders.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

  await expect(page.getByRole('button', { name: 'Download .docx', exact: true })).toBeEnabled();
});
