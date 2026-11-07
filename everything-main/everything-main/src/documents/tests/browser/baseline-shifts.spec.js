import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text) {
  await input.evaluate((el, text) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text: ' + text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
}
async function shift(page, value) {
  const button = page.getByRole('button', { name: 'Baseline shift', exact: true }); await button.focus(); await button.press('Enter');
  await page.getByRole('spinbutton', { name: 'Baseline shift (pt)', exact: true }).fill(String(value));
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, info, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await event).saveAs(path); return path;
}

test('paints raised and lowered baselines at unchanged size, edits shared styles, and reopens DOCX', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.positionPaint = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) { const t = this.getTransform(); window.positionPaint[text] = { font: this.font, a: t.a, d: t.d, x: t.a * x + t.e, y: t.d * y + t.f }; return fill.call(this, text, x, y, ...args); };
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/baseline-shifts.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Baseline shift', exact: true }); await expect(input).toHaveValue(/^Baseline shifts Á😀/); const text = await input.inputValue(); expect(await page.locator('canvas.canvas-page').count()).toBeGreaterThan(1);
  const paint = await page.evaluate(() => ({ base: window.positionPaint['Base '], up: window.positionPaint.Raised, down: window.positionPaint.Lowered, super: window.positionPaint['Raised super'] }));
  expect(paint.up.a).toBe(paint.base.a); expect(paint.up.d).toBe(paint.base.d); expect(paint.up.font).toBe(paint.base.font); expect((paint.base.y - paint.up.y) / paint.base.d).toBeCloseTo(8); expect((paint.down.y - paint.base.y) / paint.base.d).toBeCloseTo(16 / 3); expect(paint.super.a / paint.base.a).toBeCloseTo(9.5/16);
  for (const [text, value] of [['Raised', 6], ['Lowered', -4], ['Paragraph raised', 4], ['Character lowered', -2], ['Explicit zero', 0], ['Shifted header', 4]]) { await choose(input, text); await expect(button).toHaveAttribute('title', `Baseline shift: ${value} pt`); }
  await choose(input, 'Universal style'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); const unitShift = page.getByRole('spinbutton', { name: 'Style baseline shift (pt)', exact: true }); await expect(unitShift).toHaveValue('27'); expect(await unitShift.evaluate(el => el.checkValidity())).toBe(true); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await choose(input, 'Raised'); await shift(page, 8.5); await expect(button).toHaveAttribute('title', 'Baseline shift: 8.5 pt'); await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(button).toHaveAttribute('title', 'Baseline shift: 6 pt'); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose(input, 'Paragraph raised'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Style baseline shift (pt)', exact: true }).fill('-6'); await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('baseline-style-dialog.png'), animations: 'disabled' }); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await choose(input, 'Character lowered'); await page.getByRole('button', { name: 'Edit character style', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Style baseline shift (pt)', exact: true }).fill(''); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await choose(input, 'Character lowered'); await expect(button).toHaveAttribute('title', 'Baseline shift: -6 pt');
  await input.evaluate(el => { const at = el.value.indexOf('\n\n') + 1; el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }); await input.focus(); await page.keyboard.insertText('Temporary Á😀'); await expect(button).toHaveAttribute('title', 'Baseline shift: 5 pt'); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
  const saved = await download(page, testInfo, 'baseline-shifts.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, value] of [['Raised', 8.5], ['Paragraph raised', -6], ['Character lowered', -6], ['Explicit zero', 0], ['Shifted header', 4]]) { await choose(input, text); await expect(button).toHaveAttribute('title', `Baseline shift: ${value} pt`); }
  await button.focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('baseline-shifts.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('authors signed shifts, resets zero, handles mixed selection and future typing with accessible controls', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Baseline shift', exact: true }); await expect(input).toHaveValue('');
  await input.fill('Raised text\nLowered text\nPlain text\n'); await choose(input, 'Raised text'); await shift(page, 4); await choose(input, 'Lowered text'); await shift(page, -3); await choose(input, 'Plain text'); await shift(page, 4); await shift(page, 0);
  await choose(input, 'Raised text\nLowered text'); await expect(button).toHaveAttribute('title', 'Baseline shift: Mixed'); await button.click(); await expect(page.getByText(/selection has mixed shifts/)).toBeVisible();
  const amount = page.getByRole('spinbutton', { name: 'Baseline shift (pt)', exact: true }); await expect(amount).toHaveValue(''); await amount.fill('201'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(1); expect(await amount.evaluate(el => el.validity.rangeOverflow)).toBe(true); await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.focus(); await input.press('ControlOrMeta+End'); await shift(page, 2.5); await page.keyboard.insertText('Shifted typing'); await expect(button).toHaveAttribute('title', 'Baseline shift: 2.5 pt');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-baseline-shifts.docx'); await reopenDocx(page, input, saved, text);
  for (const [text, value] of [['Raised text', 4], ['Lowered text', -3], ['Plain text', 0], ['Shifted typing', 2.5]]) { await choose(input, text); await expect(button).toHaveAttribute('title', `Baseline shift: ${value} pt`); await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('12'); }
});

test('previews malformed active positions as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/baseline-shifts.docx')); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:position w:val="12"/>', '<w:position/>'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'invalid-position.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});

test('rolls back a shift that would make a mixed-baseline line taller than its page', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/baseline-shifts.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Baseline shift', exact: true }); await expect(input).toHaveValue(/^Baseline shifts/); const text = await input.inputValue();
  await choose(input, 'Raised'); await shift(page, 200); await expect(button).toHaveAttribute('title', 'Baseline shift: 200 pt');
  await choose(input, 'Lowered'); await shift(page, -200); await expect(page.getByText(/exceed the page height/)).toBeVisible(); await expect(button).toHaveAttribute('title', 'Baseline shift: -4 pt'); await expect(input).toHaveValue(text);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await choose(input, 'Raised'); await expect(button).toHaveAttribute('title', 'Baseline shift: 6 pt');
});
