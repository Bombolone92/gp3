import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text) {
  await input.evaluate((el, text) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
}
async function download(page, info, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await event).saveAs(path); return path;
}

for (const kind of ['trailing', 'wrapped']) test(`edits ${kind} spaces with inherited formatting, undo, exact text preservation and DOCX reopening`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${kind}-spaces.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Spaces Á😀/); const original = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original); await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await choose(input, 'Centered'); await page.getByRole('button', { name: 'Bold', exact: true }).click(); await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Style font size (pt)', exact: true }).fill('14'); await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const text = await input.inputValue(); expect(text).toBe('Edited ' + original); const saved = await download(page, testInfo, kind + '-spaces.docx'); await reopenDocx(page, input, saved, text); await choose(input, 'Centered'); await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true })).toHaveValue('14');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus(); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath(kind + '-spaces.png'), Buffer.from(png, 'base64')); expect(errors).toEqual([]);
});

test('authors long separators and trailing spaces, navigates collapsed carets, edits them and saves source whitespace', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  const text = 'Fresh Á😀' + ' '.repeat(200) + 'Tail\nRight   \n   '; await input.fill(text); await input.focus(); await input.press('ControlOrMeta+Home'); await input.press('End'); const end = text.indexOf('Tail'); expect(await input.evaluate(el => el.selectionStart)).toBe(end);
  const position = await input.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })); await input.press('ArrowLeft'); expect(await input.evaluate(el => el.selectionStart)).toBe(end - 1); expect(await input.evaluate(el => parseFloat(el.style.left))).toBe(position.x);
  await input.press('Shift+ArrowLeft'); expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([end - 2, end - 1]); await page.keyboard.insertText('X'); expect(await input.inputValue()).toBe(text.slice(0, end - 2) + 'X' + text.slice(end - 1)); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(text);
  await choose(input, text); await page.getByRole('button', { name: 'Underline', exact: true }).click(); await choose(input, 'Right   '); await page.getByRole('button', { name: 'Align right', exact: true }).click();
  const saved = await download(page, testInfo, 'new-trailing-spaces.docx'); await reopenDocx(page, input, saved, text); expect(await page.locator('canvas.canvas-page').count()).toBe(1);
});

test('matches native advances for long tails, ignores them for alignment and keeps pointer and selection geometry bounded', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/^A small beginning/);
  const results = await page.evaluate(async () => {
    const { layoutDocument, hitTest, caretRect, selectionRects } = await import('/src/engine/layout.js'), { paragraph, runFormat } = await import('/src/engine/model.js'), { setCanvasTextStyle } = await import('/src/engine/canvas-text.js'), { fontMetrics } = await import('/src/engine/font-metrics.js'), { measureTextGeometry } = await import('/src/engine/text-geometry.js');
    const c = document.createElement('canvas').getContext('2d'); const measure = (text, style) => { setCanvasTextStyle(c, style); return { ...fontMetrics(style), width: c.measureText(text).width }; };
    return [{}, { bold: true, italic: true, kerning: 12 }, { verticalAlign: 'superscript', characterSpacing: 1, textScale: 150 }, { characterSpacing: -.5, textScale: 75 }].map(style => {
      const text = 'AV' + ' '.repeat(1000), run = runFormat({ ...style, underline: true, highlight: 'yellow' });
      const result = layoutDocument([paragraph('', { runs: [{ text, ...run }], format: { alignment: 'right' } })], measure), line = result.lines[0], width = measureTextGeometry(text, run, measure).width, ink = measureTextGeometry('AV', run, measure).width;
      const caret = caretRect(result, text.length);
      return { width, layoutWidth: line.width, ink, x: line.fragments[0].x, edge: 720, underline: line.underlines[0].width, background: line.backgrounds[0].width, caret: caret.x, hit: hitTest(result, caret.page, caret.x, caret.y + caret.height / 2), end: text.length, selected: selectionRects(result, text.length - 5, text.length)[0], count: result.lines.length };
    });
  });
  for (const result of results) { expect(result.count).toBe(1); expect(result.layoutWidth).toBeCloseTo(result.width, 2); expect(result.x).toBeCloseTo(result.edge - result.ink, 4); expect(result.underline).toBeCloseTo(result.ink, 4); expect(result.background).toBeCloseTo(result.ink, 4); expect(result.caret).toBe(result.edge); expect(result.hit).toBe(result.end); expect(result.selected).toMatchObject({ x: 719, width: 1 }); }
});

test('previews malformed space compatibility settings as read-only with the original available', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const text = await input.inputValue();
  for (const tag of ['wrapTrailSpaces', 'ulTrailSpace']) {
    const parts = unzipSync(readFileSync('public/fixtures/wrapped-spaces.docx')); parts['word/settings.xml'] = strToU8(strFromU8(parts['word/settings.xml']).replace(`<w:${tag} w:val="on"/>`, `<w:${tag} w:val="invalid"/>`));
    await openReadOnlyPreview(page, { name: tag + '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
  }
});
