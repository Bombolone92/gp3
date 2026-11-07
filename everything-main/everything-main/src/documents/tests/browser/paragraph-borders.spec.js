import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text, caret = false) {
  await input.evaluate((el, { text, caret }) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, caret ? at : at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, caret });
}
async function open(page) {
  const button = page.getByRole('button', { name: 'Paragraph borders', exact: true }); await button.focus(); await button.press('Enter');
  return page.getByRole('dialog', { name: 'Paragraph borders', exact: true });
}
async function edge(dialog, name, { style, width, distance, color }, prefix = '') {
  if (style) await dialog.getByRole('combobox', { name: `${prefix}${name} border style`, exact: true }).selectOption(style);
  if (width !== undefined) await dialog.getByRole('spinbutton', { name: `${prefix}${name} border width (pt)`, exact: true }).fill(String(width));
  if (distance !== undefined) await dialog.getByRole('spinbutton', { name: `${prefix}${name} border distance (pt)`, exact: true }).fill(String(distance));
  if (color !== undefined) await dialog.getByRole('textbox', { name: `${prefix}${name} border color`, exact: true }).fill(color);
}
async function apply(page, dialog) {
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
async function pixels(page, hex, index = 0) {
  return page.locator('canvas.canvas-page').nth(index).evaluate((canvas, hex) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = hex.match(/../g).map(v => parseInt(v, 16)); let count = 0;
    for (let i = 0; i < data.length; i += 4) if (rgb.every((v, j) => Math.abs(data[i + j] - v) <= 2)) count++;
    return count;
  }, hex);
}

test('paints joined borders, editing and repeated headers, then saves and reopens the independent fixture', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-borders.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Paragraph borders', exact: true });
  await expect(input).toHaveValue(/^Paragraph borders Á😀/); const text = await input.inputValue(); expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(2);
  await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true'); expect(await pixels(page, '224466')).toBeGreaterThan(100); expect(await pixels(page, '663399')).toBeGreaterThan(100);
  await choose(input, 'Joined first'); let dialog = await open(page);
  await expect(dialog.getByRole('combobox', { name: 'Left border style', exact: true })).toHaveValue('dotted');
  await dialog.getByRole('button', { name: 'Bottom only', exact: true }).click(); await edge(dialog, 'Bottom', { style: 'double', width: 2, distance: 4, color: 'CC3300' }); await apply(page, dialog);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Left border style', exact: true })).toHaveValue('dotted');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose(input, 'Themed bottom'); dialog = await open(page); await dialog.getByRole('button', { name: 'No borders', exact: true }).click(); await apply(page, dialog); await expect(button).toHaveAttribute('title', 'Paragraph borders: None');
  await choose(input, 'Bordered header'); dialog = await open(page); await dialog.getByRole('button', { name: 'Box', exact: true }).click();
  for (const side of ['Top', 'Left', 'Bottom', 'Right']) await edge(dialog, side, { color: 'AA3377' });
  await apply(page, dialog); await choose(input, 'Tail', true);
  let repeated = 0; for (let index = 1; index < await page.locator('canvas.canvas-page').count(); index++) if (await pixels(page, 'AA3377', index) > 100) repeated++;
  expect(repeated).toBeGreaterThan(1); await expect(input).toHaveValue(text);
  const saved = await download(page, testInfo, 'paragraph-borders.docx'); await reopenDocx(page, input, saved, text);
  await choose(input, 'Joined first'); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Bottom border style', exact: true })).toHaveValue('double'); await expect(dialog.getByRole('textbox', { name: 'Bottom border color', exact: true })).toHaveValue('CC3300');
  await page.screenshot({ path: testInfo.outputPath('paragraph-borders-dialog.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await choose(input, 'Tail', true);
  for (const [canvas, name] of [[page.locator('canvas.canvas-page').first(), 'paragraph-borders.png'], [page.locator('canvas.canvas-page').last(), 'paragraph-borders-table.png']]) {
    const png = await canvas.evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath(name), Buffer.from(png, 'base64'));
  }
  expect(errors).toEqual([]);
});

test('authors box and bottom borders, removes them explicitly, and preserves fresh-document exports', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(''); await input.fill('Box paragraph\nBottom paragraph\nPlain paragraph');
  await choose(input, 'Box paragraph'); let dialog = await open(page); await dialog.getByRole('button', { name: 'Box', exact: true }).click();
  for (const side of ['Top', 'Left', 'Bottom', 'Right']) await edge(dialog, side, { color: '224466' }); await apply(page, dialog);
  await choose(input, 'Bottom paragraph'); dialog = await open(page); await dialog.getByRole('button', { name: 'Bottom only', exact: true }).click(); await edge(dialog, 'Bottom', { style: 'dashed', width: 1.5, distance: 3, color: 'CC3300' }); await apply(page, dialog);
  await choose(input, 'Plain paragraph'); dialog = await open(page); await dialog.getByRole('button', { name: 'All borders', exact: true }).click(); await apply(page, dialog);
  dialog = await open(page); await dialog.getByRole('button', { name: 'No borders', exact: true }).click(); await apply(page, dialog);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-paragraph-borders.docx'); await reopenDocx(page, input, saved, text);
  await choose(input, 'Box paragraph'); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Top border style', exact: true })).toHaveValue('single'); await expect(dialog.getByRole('textbox', { name: 'Left border color', exact: true })).toHaveValue('224466');
});

test('edits style border sides, restores inheritance and keeps direct overrides', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-borders.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Paragraph borders/); await choose(input, 'Joined first');
  await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Edit paragraph style' });
  await edge(dialog, 'Right', { style: 'double', width: 2, distance: 1, color: 'AA3377' }, 'Style '); await apply(page, dialog);
  await choose(input, 'Joined second'); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Right border style', exact: true })).toHaveValue('double'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await choose(input, 'Partial direct border'); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Right border style', exact: true })).toHaveValue('none'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await choose(input, 'Joined first'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Edit paragraph style' });
  await dialog.getByRole('combobox', { name: 'Style Left border style', exact: true }).selectOption(''); await apply(page, dialog);
  dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Left border style', exact: true })).toHaveValue('single'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Left border style', exact: true })).toHaveValue('dotted');
});

test('rolls back body borders outside the page and previews unsupported imported borders', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-borders.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Paragraph borders/); const before = await input.inputValue();
  await choose(input, 'Paragraph borders'); const dialog = await open(page); await edge(dialog, 'Left', { style: 'single', width: 12, distance: 31 });
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText(/cannot fit/);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(input).toHaveValue(before);
  const parts = unzipSync(readFileSync('public/fixtures/paragraph-borders.docx')); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:bottom w:val="single" w:sz="8" w:space="4"', '<w:bottom w:val="wave" w:sz="8" w:space="4"'));
  await openReadOnlyPreview(page, { name: 'unsupported-border.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});

test('clears a side across mixed widths and colors without requiring disabled fields', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(''); await input.fill('First\nSecond');
  for (const [text, width, color] of [['First', 1, '224466'], ['Second', 2, 'CC3300']]) {
    await choose(input, text); const dialog = await open(page);
    await edge(dialog, 'Bottom', { style: 'single', width, color }); await apply(page, dialog);
  }
  await choose(input, 'First\nSecond'); let dialog = await open(page);
  await expect(dialog.getByRole('spinbutton', { name: 'Bottom border width (pt)', exact: true })).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: 'Bottom border color', exact: true })).toHaveValue('');
  await edge(dialog, 'Bottom', { style: 'none' }); await apply(page, dialog);
  await expect(page.getByRole('button', { name: 'Paragraph borders', exact: true })).toHaveAttribute('title', 'Paragraph borders: None');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  dialog = await open(page); await expect(dialog.getByRole('combobox', { name: 'Bottom border style', exact: true })).toHaveValue('single');
  await expect(dialog.getByRole('textbox', { name: 'Bottom border color', exact: true })).toHaveValue('');
  // Applying unchanged mixed fields must remain a no-op and close normally.
  await apply(page, dialog);
});
