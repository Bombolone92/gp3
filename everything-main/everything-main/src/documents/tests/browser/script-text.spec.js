import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text, last = false) {
  await input.evaluate((el, { text, last }) => { const at = last ? el.value.lastIndexOf(text) : el.value.indexOf(text); if (at < 0) throw new Error('Missing text: ' + text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, last });
}
async function position(page, value) {
  await expect(page.getByRole('button', { name: 'Superscript', exact: true })).toHaveAttribute('aria-pressed', value === 'mixed' ? 'mixed' : String(value === 'superscript'));
  await expect(page.getByRole('button', { name: 'Subscript', exact: true })).toHaveAttribute('aria-pressed', value === 'mixed' ? 'mixed' : String(value === 'subscript'));
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}

test('paints scripts with font metrics, edits shared and direct positions, and reopens imported DOCX', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.scriptPaint = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) { const t = this.getTransform(); window.scriptPaint[text] = { font: this.font, a: t.a, d: t.d, e: t.e, f: t.f, x, y }; return fill.call(this, text, x, y, ...args); };
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/script-text.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Script text Á😀/); const text = await input.inputValue(); expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  for (const [text, value] of [['Raised direct', 'superscript'], ['Lowered direct', 'subscript'], ['Paragraph raised', 'superscript'], ['Character lowered', 'subscript'], ['Explicit baseline', 'baseline'], ['Repeated script header', 'superscript'], ['Header baseline', 'baseline']]) { await choose(input, text); await position(page, value); }
  const transforms = await page.evaluate(() => ({ baseline: Object.entries(window.scriptPaint).find(([text]) => text.startsWith('Script text '))[1], raised: window.scriptPaint['Raised direct'], lowered: window.scriptPaint['Lowered direct'], number: window.scriptPaint['1.'] }));
  expect(transforms.raised.a / transforms.baseline.a).toBeCloseTo(9.5/16); expect(transforms.raised.d / transforms.baseline.d).toBeCloseTo(9.5/16); expect(transforms.lowered.a).toBe(transforms.raised.a);
  expect(Number(/([0-9.]+)px/.exec(transforms.raised.font)[1])).toBeCloseTo(16 * 4 / 3, 3); expect(transforms.raised.x).toBe(0); expect(transforms.raised.y).toBe(0); expect(transforms.number.a / transforms.baseline.a).toBeCloseTo(7/12);
  const xOffset = (transforms.raised.e - transforms.lowered.e) / transforms.baseline.a; expect(xOffset).toBeCloseTo(0);
  await choose(input, 'Raised direct'); const sub = page.getByRole('button', { name: 'Subscript', exact: true }); await sub.focus(); await sub.press('Enter'); await position(page, 'subscript'); await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('16');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await position(page, 'superscript'); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await position(page, 'subscript');
  await choose(input, 'Paragraph raised'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await page.getByRole('combobox', { name: 'Style text position', exact: true }).selectOption('subscript');
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('script-style-dialog.png'), animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await choose(input, 'Paragraph raised'); await position(page, 'subscript');
  await choose(input, 'Styled character'); await page.getByRole('button', { name: 'Edit character style', exact: true }).click(); await page.getByRole('combobox', { name: 'Style text position', exact: true }).selectOption('baseline'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await choose(input, 'Character lowered'); await position(page, 'baseline'); await choose(input, 'Explicit baseline'); await position(page, 'baseline');
  await input.evaluate(el => { const at = el.value.indexOf('\n\n') + 1; el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }); await input.focus(); await position(page, 'superscript'); await page.keyboard.insertText('Temporary Á😀'); await position(page, 'superscript'); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
  const saved = await download(page, testInfo, 'script-text.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, value] of [['Raised direct', 'subscript'], ['Paragraph raised', 'subscript'], ['Character lowered', 'baseline'], ['Repeated script header', 'superscript']]) { await choose(input, text); await position(page, value); }
  await sub.focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('script-text.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('authors mutually exclusive scripts, resets to baseline, and formats future typing without changing font size', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }), sup = page.getByRole('button', { name: 'Superscript', exact: true }), sub = page.getByRole('button', { name: 'Subscript', exact: true }); await expect(input).toHaveValue('');
  await input.fill('H2O Á😀\nE = mc'); await choose(input, '2'); await sup.click(); await position(page, 'superscript'); await sub.click(); await position(page, 'subscript'); await sub.click(); await position(page, 'baseline'); await sub.focus(); await sub.press('Space'); await position(page, 'subscript');
  await choose(input, 'H2O'); await position(page, 'mixed'); await input.focus(); await input.press('ControlOrMeta+End'); await sup.click(); await page.keyboard.insertText('2'); await position(page, 'superscript'); await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('12');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-script-text.docx'); await reopenDocx(page, input, saved, text);
  await choose(input, '2'); await position(page, 'subscript'); await choose(input, '2', true); await position(page, 'superscript'); await choose(input, 'O Á😀'); await position(page, 'baseline');
});

test('previews an out-of-range manual text position as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/script-text.docx')); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:vertAlign w:val="subscript"/>', '<w:vertAlign w:val="subscript"/><w:position w:val="401"/>'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'manual-position.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});
