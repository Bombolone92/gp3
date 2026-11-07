import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text) {
  await input.evaluate((el, text) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
}
async function highlight(page, value) {
  const button = page.getByRole('button', { name: 'Text highlight', exact: true }); await button.focus(); await button.press('Enter');
  const menu = page.getByRole('menu', { name: 'Text highlight', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu.getByRole('menuitemradio')).toHaveCount(17);
  const name = value === 'none' ? 'No highlight' : value.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
  await menu.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(menu).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
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

test('renders highlights above shading and beneath selection, edits repeated headers, and preserves imported DOCX data', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/text-highlights.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Text highlight', exact: true });
  await expect(input).toHaveValue(/^Highlights Á😀/); const text = await input.inputValue(), pages = await page.locator('canvas.canvas-page').count(); expect(pages).toBeGreaterThan(1);
  for (const hex of ['FFFF00', '000000', 'DDEEFF', 'C3D69B', '445566', '00008B', '008B8B', '006400', '8B0000', 'A9A9A9', 'D3D3D3', 'FF00FF']) expect(await pixels(page, hex), hex).toBeGreaterThan(5);
  const samples = await page.locator('canvas.canvas-page').first().evaluate(canvas => {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = (x, y) => [...d.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)];
    const black = (x, y) => rgb(x, y).every(v => v === 0);
    let block, blue = [];
    for (let y = 0; y < canvas.height; y++) {
      let start = 0, length = 0;
      for (let x = 0; x < canvas.width; x++) {
        if (rgb(x, y).join() === '0,80,200') blue.push([x, y]);
        if (black(x, y)) { if (!length) start = x; length++; }
        else { if (!block && length > 30) block = { x: start, y, width: length }; length = 0; }
      }
    }
    let white = 0, bottom = block.y;
    // Highlight is ignored when resolving automatic ink (independent
    // page-background controls): black highlight on a light page has no white ink.
    const hasBlack = y => Array.from({ length: block.width }, (_, dx) => black(block.x + dx, y)).some(Boolean);
    while (bottom < canvas.height && hasBlack(bottom)) bottom++;
    for (let y = block.y + 2; y < bottom - 2; y++) for (let x = block.x + 2; x < block.x + block.width - 2; x++) if (rgb(x, y).every(v => v > 240)) white++;
    const center = axis => Math.round((Math.min(...blue.map(p => p[axis])) + Math.max(...blue.map(p => p[axis]))) / 2);
    return { white, imageCenter: rgb(center(0), center(1)) };
  }); expect(samples.white).toBe(0); expect(samples.imageCenter).toEqual([255, 0, 255]);
  await choose(input, 'Yellow '); expect(await pixels(page, 'C7D532')).toBeGreaterThan(5); await highlight(page, 'cyan'); await expect(button).toHaveAttribute('title', 'Text highlight: Cyan');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await choose(input, 'Yellow '); await expect(button).toHaveAttribute('title', 'Text highlight: Yellow'); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose(input, 'Shaded then highlighted'); const oldShade = await pixels(page, 'DDEEFF'); await highlight(page, 'none'); await choose(input, 'Highlights'); expect(await pixels(page, 'DDEEFF')).toBeGreaterThan(oldShade + 100); await choose(input, 'Shaded then highlighted'); await expect(button).toHaveAttribute('title', 'Text highlight: No highlight');
  await choose(input, 'Highlighted header'); await highlight(page, 'magenta'); await choose(input, 'Tail'); expect(await pixels(page, 'FF00FF', 1)).toBeGreaterThan(50);
  await expect(input).toHaveValue(text); await expect(page.locator('canvas.canvas-page')).toHaveCount(pages);
  const saved = await download(page, testInfo, 'text-highlights.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, label] of [['Yellow ', 'Cyan'], ['Shaded then highlighted', 'No highlight'], ['Highlighted header', 'Magenta']]) { await choose(input, text); await expect(button).toHaveAttribute('title', 'Text highlight: ' + label); }
  await choose(input, 'Tail'); await button.focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('text-highlights.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('authors and removes highlights and carries a highlight into future typing with keyboard controls', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Text highlight', exact: true }); await expect(input).toHaveValue('');
  await input.fill('Yellow text\nPlain text\n'); await choose(input, 'Yellow text'); await highlight(page, 'yellow');
  await choose(input, 'Plain text'); await highlight(page, 'blue'); await highlight(page, 'none');
  await input.press('ControlOrMeta+End'); await highlight(page, 'green'); await page.keyboard.insertText('Green typing');
  await choose(input, 'Yellow text\nPlain text'); await expect(button).toHaveAttribute('title', 'Text highlight: Mixed'); await button.click(); await expect(page.getByText(/selection has mixed highlights/)).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'Text highlight', exact: true })).toHaveCount(0);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-text-highlights.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, label] of [['Yellow text', 'Yellow'], ['Plain text', 'No highlight'], ['Green typing', 'Green']]) { await choose(input, text); await expect(button).toHaveAttribute('title', 'Text highlight: ' + label); }
});

test('previews unsupported patterned shading as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/text-highlights.docx')); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:highlight w:val="yellow"/>', '<w:highlight w:val="yellow"/><w:shd w:val="pct20" w:fill="FFFF00"/>'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'invalid-highlights.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});
