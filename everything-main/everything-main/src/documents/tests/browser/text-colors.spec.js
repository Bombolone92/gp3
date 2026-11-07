import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text) {
  await input.evaluate((el, text) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
}
async function color(page, value) {
  const button = page.getByRole('button', { name: 'Text color', exact: true }); await button.focus(); await button.press('Enter');
  const menu = page.getByRole('menu', { name: 'Text color', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (value === 'auto') await menu.getByRole('menuitemradio', { name: 'Automatic', exact: true }).click();
  else {
    await menu.getByLabel('Custom text color hex value').fill('#' + value);
    await menu.getByRole('button', { name: 'Apply custom text color' }).click();
  }
  await expect(menu).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
async function pixels(page, hex, index = 0) {
  return page.locator('canvas.canvas-page').nth(index).evaluate((canvas, hex) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = hex.match(/../g).map(v => parseInt(v, 16)); let count = 0;
    for (let i = 0; i < data.length; i += 4) if (rgb.every((v, j) => Math.abs(data[i + j] - v) <= 8)) count++;
    return count;
  }, hex);
}

test('paints imported themes, colors, underlines and repeated headers; edits styles and saves preserved theme markup', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/text-colors.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Text color', exact: true });
  await expect(input).toHaveValue(/^Colors red blue Á😀/); const text = await input.inputValue(), pages = await page.locator('canvas.canvas-page').count(); expect(pages).toBeGreaterThan(1);
  for (const rgb of ['FF0000', '0000FF', 'C0504D', '95B3D7', '008800']) expect(await pixels(page, rgb), rgb).toBeGreaterThan(3);
  expect(await pixels(page, '4F81BD')).toBeGreaterThan(0);
  expect(await pixels(page, 'C0504D', 1)).toBeGreaterThan(3);
  const darkText = await page.locator('canvas.canvas-page').first().evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] === 32 && d[i + 1] === 32 && d[i + 2] === 32) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
    let white = 0; for (let y = y0 + 2; y < y1 - 2; y++) for (let x = x0 + 2; x < x1 - 2; x++) { const i = (y * c.width + x) * 4; if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white++; } return white;
  }); expect(darkText).toBeGreaterThan(5);
  await choose(input, 'red '); await color(page, '663399'); await expect(button).toHaveAttribute('title', 'Text color: #663399'); expect(await pixels(page, '663399')).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await choose(input, 'red '); await expect(button).toHaveAttribute('title', 'Text color: #FF0000');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await choose(input, 'Paragraph theme');
  await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await expect(page.getByLabel('Style text color')).toHaveValue('C0504D');
  await page.getByLabel('Style text color').fill('008844'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await choose(input, 'Inherited theme'); await expect(button).toHaveAttribute('title', 'Text color: #008844'); expect(await pixels(page, '008844', 1)).toBeGreaterThan(3);
  await choose(input, 'Automatic override'); await expect(button).toHaveAttribute('title', 'Text color: Automatic');
  await expect(input).toHaveValue(text); await expect(page.locator('canvas.canvas-page')).toHaveCount(pages);
  const saved = await download(page, testInfo, 'text-colors.docx'); await reopenDocx(page, input, saved, text); await choose(input, 'red '); await expect(button).toHaveAttribute('title', 'Text color: #663399');
  await choose(input, 'Inherited theme'); await expect(button).toHaveAttribute('title', 'Text color: #008844');
  await button.focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('text-colors.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('authors RGB, automatic and future typing colors with keyboard-accessible controls and save/reopen', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Text color', exact: true }); await expect(input).toHaveValue('');
  await input.fill('Red text\nAutomatic text\n'); await choose(input, 'Red text'); await color(page, 'CC2200'); await expect(button).toHaveAttribute('title', 'Text color: #CC2200');
  await choose(input, 'Automatic text'); await color(page, '112233'); await expect(button).toHaveAttribute('title', 'Text color: #112233'); await color(page, 'auto');
  await input.press('ControlOrMeta+End'); await color(page, '008844'); await page.keyboard.insertText('Green typing');
  await choose(input, 'Red text'); await expect(button).toHaveAttribute('title', 'Text color: #CC2200');
  await choose(input, 'Red text\nAutomatic text'); await button.click(); await expect(page.getByText(/selection has mixed colors/)).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'Text color', exact: true })).toHaveCount(0);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-text-colors.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, title] of [['Red text', '#CC2200'], ['Automatic text', 'Automatic'], ['Green typing', '#008844']]) { await choose(input, text); await expect(button).toHaveAttribute('title', 'Text color: ' + title); }
});

test('previews an unresolved active theme as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/text-colors.docx')); parts['word/_rels/document.xml.rels'] = strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('Target="theme/theme1.xml"', 'Target="theme/missing.xml"'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'invalid-color.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

});
