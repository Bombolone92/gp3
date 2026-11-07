import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const button = page => page.getByRole('button', { name: 'Contextual paragraph spacing', exact: true });
async function choose(input, text) {
  await input.evaluate((el, text) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text: ' + text); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
}
async function download(page, info, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await event).saveAs(path); return path;
}
async function watchPaint(page) {
  await page.addInitScript(() => {
    window.contextPaint = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) { window.contextPaint[text] = { x, y, font: this.font }; return fill.call(this, text, x, y, ...rest); };
  });
}
async function distance(page, first, second) { return page.evaluate(([a, b]) => { const firstFragment = text => Object.entries(window.contextPaint).find(([part]) => part && text.startsWith(part))[1]; return firstFragment(b).y - firstFragment(a).y; }, [first, second]); }

test('paints contextual gaps, edits direct and shared flags with keyboard access, and saves/reopens imported formatting', async ({ page }, testInfo) => {
  await watchPaint(page); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/contextual-spacing.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), toggle = button(page); await expect(input).toHaveValue(/^Spec first Á😀/); const text = await input.inputValue();
  await expect(toggle.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  const collapsed = await distance(page, 'Both first', 'Both second'), spec = await distance(page, 'Spec first Á😀', 'Spec second'); expect(spec - collapsed).toBeCloseTo(8 / 3, 4);
  expect(await distance(page, 'Reverse first', 'Reverse second') - collapsed).toBeCloseTo(8 / 3, 4);
  for (const [text, value] of [['Spec first Á😀', 'true'], ['Spec second', 'false'], ['Inherited first', 'true'], ['Style reset', 'false'], ['Direct reset', 'false'], ['Inherited list', 'true'], ['Direct list', 'false'], ['Direct list reset', 'true'], ['Header first', 'true']]) { await choose(input, text); await expect(toggle).toHaveAttribute('aria-pressed', value); }
  await choose(input, 'Spec first Á😀\nSpec second'); await expect(toggle).toHaveAttribute('aria-pressed', 'mixed');
  await choose(input, 'Spec first Á😀'); const selection = await input.evaluate(el => [el.selectionStart, el.selectionEnd]); await toggle.focus(); await toggle.press('Space'); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await expect(input).toBeFocused(); expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual(selection); expect(await distance(page, 'Spec first Á😀', 'Spec second') - spec).toBeCloseTo(40 / 3, 4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await distance(page, 'Spec first Á😀', 'Spec second')).toBeCloseTo(spec); await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await choose(input, 'Inherited first'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await page.getByRole('combobox', { name: 'Style contextual spacing', exact: true }).selectOption('false'); await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('contextual-style.png'), animations: 'disabled' }); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await choose(input, 'Different child'); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await choose(input, 'Direct reset'); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await choose(input, 'Header first\nHeader second'); await toggle.focus(); await toggle.press('Enter'); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const saved = await download(page, testInfo, 'contextual-spacing.docx'); await reopenDocx(page, input, saved, text); await choose(input, 'Spec first Á😀'); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); await choose(input, 'Header first\nHeader second'); await expect(toggle).toHaveAttribute('aria-pressed', 'false'); expect(await distance(page, 'Spec first Á😀', 'Spec second') - collapsed).toBeCloseTo(16, 4);
  await toggle.focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('contextual-spacing.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('retains the table compatibility flag and its ordinary cell spacing through edits and save/reopen', async ({ page }, testInfo) => {
  await watchPaint(page); await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/contextual-table-spacing.docx'); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Spec first/); const text = await input.inputValue();
  const line = await distance(page, 'Both first', 'Both second'), gap = await distance(page, 'Header first', 'Header second'); expect(gap - line).toBeCloseTo(8, 4);
  await choose(input, 'Header first'); await expect(button(page)).toHaveAttribute('aria-pressed', 'true'); await button(page).click(); await expect(button(page)).toHaveAttribute('aria-pressed', 'false'); expect(await distance(page, 'Header first', 'Header second')).toBeCloseTo(gap);
  const saved = await download(page, testInfo, 'contextual-table-spacing.docx'); await reopenDocx(page, input, saved, text); expect(await distance(page, 'Header first', 'Header second')).toBeCloseTo(gap); await choose(input, 'Header second'); await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
});

test('authors contextual spacing across selected paragraphs and retains it through Unicode paragraph splits and history', async ({ page }, testInfo) => {
  await watchPaint(page); await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(''); await input.fill('Context first\nContext second\nOrdinary third');
  const ordinary = await distance(page, 'Context first', 'Context second'); await choose(input, 'Context first\nContext second'); await button(page).click(); await expect(button(page)).toHaveAttribute('aria-pressed', 'true'); expect(ordinary - await distance(page, 'Context first', 'Context second')).toBeCloseTo(12, 4);
  await choose(input, 'Context second'); await input.focus(); await input.press('ArrowRight'); await input.press('Enter'); await page.keyboard.insertText('Á😀'); await expect(button(page)).toHaveAttribute('aria-pressed', 'true'); await input.press('ControlOrMeta+z'); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue('Context first\nContext second\nOrdinary third');
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-contextual-spacing.docx'); await reopenDocx(page, input, saved, text); await choose(input, 'Context first\nContext second'); await expect(button(page)).toHaveAttribute('aria-pressed', 'true'); await choose(input, 'Ordinary third'); await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
});

test('removes a shared style declaration to inherit contextual spacing and restores direct off with undo', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/contextual-spacing.docx'); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Spec first/);
  await choose(input, 'Style reset'); await expect(button(page)).toHaveAttribute('aria-pressed', 'false'); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await page.getByRole('combobox', { name: 'Style contextual spacing', exact: true }).selectOption(''); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
  await choose(input, 'Direct reset'); await expect(button(page)).toHaveAttribute('aria-pressed', 'false'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await choose(input, 'Style reset'); await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
});

test('previews malformed contextual spacing as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/contextual-spacing.docx')); parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:contextualSpacing w:val="1"/>', '<w:contextualSpacing w:val="yes"/>'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue(); await openReadOnlyPreview(page, { name: 'invalid-context.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
});
