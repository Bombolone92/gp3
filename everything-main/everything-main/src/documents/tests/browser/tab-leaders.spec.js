import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text, end) {
  await input.evaluate((el, { text, end }) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, end ? el.value.indexOf(end) + end.length : at); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, end });
}
async function fixture(page) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/tab-leaders.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Tab leaders/); return input;
}
async function dialog(page) { await page.getByRole('button', { name: 'Indents and tabs', exact: true }).click(); return page.getByRole('dialog', { name: 'Indents and tabs' }); }
async function download(page, info, name) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await pending).saveAs(path); return path; }
async function screenshot(page, info, index, name) { const png = await page.locator('canvas.canvas-page').nth(index).evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(info.outputPath(name), Buffer.from(png, 'base64')); }

test('edits inherited leaders with accessible controls, undoes and reopens the independent fixture', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const input = await fixture(page), original = await input.inputValue(), undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(page.getByRole('button', { name: 'Indents and tabs', exact: true }).locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await screenshot(page, info, 0, 'tab-leaders-page.png'); await screenshot(page, info, 1, 'tab-leaders-table.png');
  await screenshot(page, info, 2, 'tab-leaders-continued-table.png');
  await choose(input, 'Inherited contents'); let d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('dot');
  await d.getByRole('combobox', { name: 'Tab 1 leader', exact: true }).selectOption('hyphen');
  await expect(d.getByRole('button', { name: 'Remove tab 1', exact: true }).locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await d.getByRole('button', { name: 'Apply', exact: true }).press('Enter'); await expect(input).toBeFocused();
  await undo.click(); d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('dot'); await d.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose(input, 'Direct none'); d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('none'); await d.getByRole('combobox', { name: 'Tab 1 leader', exact: true }).selectOption('middleDot'); await d.getByRole('button', { name: 'Apply', exact: true }).click();
  await choose(input, 'Inherited contents'); await input.press('End'); await input.press('Enter'); await page.keyboard.insertText('Á😀'); await undo.click(); await undo.click(); await expect(input).toHaveValue(original);
  const saved = await download(page, info, 'tab-leaders.docx'); await reopenDocx(page, input, saved, original); await expect(undo).toBeDisabled();
  await choose(input, 'Inherited contents'); d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('hyphen'); await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await choose(input, 'Direct none'); d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('middleDot'); expect(errors).toEqual([]);
});

test('authors leader tabs on multiple paragraphs and preserves keyboard selection and source text', async ({ page }, info) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  const text = 'New contents\t42\nSecond\t99'; await input.fill(text); await choose(input, 'New contents', '99'); const selected = await input.evaluate(el => [el.selectionStart, el.selectionEnd]);
  const d = await dialog(page); await d.getByRole('button', { name: 'Add tab stop', exact: true }).click(); await d.getByRole('spinbutton', { name: 'Tab 1 position (in)', exact: true }).fill('3');
  await d.getByRole('combobox', { name: 'Tab 1 alignment', exact: true }).selectOption('right'); await d.getByRole('combobox', { name: 'Tab 1 leader', exact: true }).selectOption('dot'); await d.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual(selected); await expect(input).toHaveValue(text);
  await choose(input, '42'); await input.press('ArrowLeft'); expect(await input.evaluate(el => el.selectionStart)).toBe(12); await input.press('ArrowRight'); expect(await input.evaluate(el => el.selectionStart)).toBe(13);
  const saved = await download(page, info, 'new-tab-leaders.docx'); await reopenDocx(page, input, saved, text); await screenshot(page, info, 0, 'new-tab-leaders.png');
});

test('paints repeated leader glyphs with tab formatting and aligns native caret hits at zoom', async ({ page }) => {
  await page.addInitScript(() => {
    window.leaderPaint = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { if (/^([.\-_·])\1{3,}$/.test(text)) window.leaderPaint.push({ text, font: this.font, color: this.fillStyle, width: this.measureText(text).width }); return fill.call(this, text, ...args); };
  });
  const input = await fixture(page); await expect.poll(() => page.evaluate(() => window.leaderPaint.length)).toBeGreaterThan(10);
  const painted = await page.evaluate(() => window.leaderPaint); for (const c of ['.', '-', '_', '·']) expect(painted.some(p => p.text.startsWith(c))).toBe(true);
  expect(painted.filter(p => p.text.startsWith('·') && p.color === '#993366')).toEqual(expect.arrayContaining([expect.objectContaining({ font: expect.stringMatching(/italic.*(?:bold|700)/) })]));
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1.5'); await choose(input, '12');
  const caret = await input.evaluate(el => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), height: parseFloat(el.style.height), at: el.selectionStart }));
  const surface = await page.locator('.canvas-pages').boundingBox(); await page.mouse.click(surface.x + caret.left + 1, surface.y + caret.top + caret.height / 2); expect(await input.evaluate(el => el.selectionStart)).toBe(caret.at);
  await input.press('ArrowLeft'); expect(await input.evaluate(el => el.selectionStart)).toBe(caret.at - 1);
});

test('keeps mixed tabs unchanged and fits leader controls on a narrow screen', async ({ page }, info) => {
  const input = await fixture(page); await choose(input, 'Inherited contents', '34'); let d = await dialog(page);
  await expect(d.getByText('Tab stops vary across the selection.', { exact: false })).toBeVisible(); await d.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 }); await choose(input, 'Two stops'); d = await dialog(page);
  for (const name of ['Tab 1 leader', 'Tab 2 leader']) await expect(d.getByRole('combobox', { name, exact: true })).toBeInViewport();
  expect(await d.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: info.outputPath('tab-leaders-narrow.png') });
  await d.getByRole('combobox', { name: 'Tab 1 leader', exact: true }).selectOption('none'); await d.getByRole('button', { name: 'Apply', exact: true }).click(); d = await dialog(page); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('none'); await expect(d.getByRole('combobox', { name: 'Tab 2 leader', exact: true })).toHaveValue('hyphen');
});

test('previews malformed leader markup as read-only with the original available', async ({ page }, info) => {
  const input = await fixture(page), original = await input.inputValue(), parts = unzipSync(readFileSync('public/fixtures/tab-leaders.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('w:leader="dot"', 'w:leader="unknown"'));
  const path = info.outputPath('invalid-tab-leader.zip'); writeFileSync(path, zipSync(parts)); await openReadOnlyPreview(page, path);

});

test('rolls back a leader edit whose tiny glyphs exceed the preview density limit', async ({ page }) => {
  const input = await fixture(page), result = await page.evaluate(async () => {
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js'), { paragraph } = await import('/src/engine/model.js');
    const host = document.createElement('div'); document.body.append(host); const errors = [];
    const editor = new CanvasEditor(host, { paragraphs: [paragraph('', { runs: [{ text: 'A', fontSize: 12 }, { text: '\t', fontSize: 1, textScale: 1 }, { text: 'B', fontSize: 12 }], format: { tabs: [{ position: 4320, alignment: 'right' }] } })], onError: e => errors.push(String(e)) });
    const before = JSON.stringify(editor.model.snapshot());
    editor.setParagraphFormat({ tabs: [{ position: 4320, alignment: 'right', leader: 'dot' }] });
    const result = { errors, intact: before === JSON.stringify(editor.model.snapshot()), history: editor.model.history.length, leaders: editor.layout.lines[0].leaders.length };
    editor.destroy(); host.remove(); return result;
  });
  expect(result.intact).toBe(true); expect(result.history).toBe(0); expect(result.leaders).toBe(0); expect(result.errors.join(' ')).toMatch(/dense/); await expect(input).toHaveValue(/^Tab leaders/);
});

test('preserves numbering-only stops during leader edits and converts an explicitly changed alignment', async ({ page }, info) => {
  const parts = unzipSync(readFileSync('public/fixtures/tab-leaders.docx')), source = strFromU8(parts['word/document.xml']);
  const ordinary = 'w:pos="360" w:val="left" w:leader="dot"'; expect(source).toContain(ordinary);
  parts['word/document.xml'] = strToU8(source.replace(ordinary, 'w:pos="360" w:val="num" w:leader="dot"'));
  const path = info.outputPath('numbering-leader-input.zip'); writeFileSync(path, zipSync(parts));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Tab leaders/); const original = await input.inputValue();
  await choose(input, 'Numbered leader'); let d = await dialog(page);
  await d.getByRole('combobox', { name: 'Tab 1 leader', exact: true }).selectOption('hyphen'); await d.getByRole('button', { name: 'Apply', exact: true }).click();
  const saved = await download(page, info, 'numbering-leader-edit.zip');
  expect(strFromU8(unzipSync(readFileSync(saved))['word/document.xml'])).toContain('w:val="num" w:pos="360" w:leader="hyphen"');
  await reopenDocx(page, input, saved, original); await choose(input, 'Numbered leader'); d = await dialog(page);
  await d.getByRole('combobox', { name: 'Tab 1 alignment', exact: true }).selectOption('right'); await d.getByRole('button', { name: 'Apply', exact: true }).click();
  const changed = await download(page, info, 'numbering-alignment-edit.zip');
  expect(strFromU8(unzipSync(readFileSync(changed))['word/document.xml'])).toContain('w:val="right" w:pos="360" w:leader="hyphen"');
  await reopenDocx(page, input, changed, original); await choose(input, 'Numbered leader'); d = await dialog(page);
  await expect(d.getByRole('combobox', { name: 'Tab 1 alignment', exact: true })).toHaveValue('right'); await expect(d.getByRole('combobox', { name: 'Tab 1 leader', exact: true })).toHaveValue('hyphen');
});
