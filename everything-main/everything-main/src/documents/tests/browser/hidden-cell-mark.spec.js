import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const download = async (page, info, name) => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await pending).saveAs(path); return path; };
const select = (input, text) => input.evaluate((el, text) => { const at = el.value.indexOf(text); el.focus(); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select')); }, text);
const word = JSON.parse(readFileSync('tests/fixtures/hidden-cell-mark/native-spacing.json','utf8'));
async function geometry(page, bytes) {
 return page.evaluate(async bytes => {
  const { DocxPackage } = await import('/src/engine/docx.js'), { layoutDocument } = await import('/src/engine/layout.js'), { pageGeometry } = await import('/src/engine/page-settings.js'), { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
  const p = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(p); const ctx = document.createElement('canvas').getContext('2d');
  const layout = layoutDocument(p.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(p.pageSettings), p.numbering, p.tables);
  return { rows: p.tables[0].rows.map(r => layout.cells.find(c => c.id === r.cells[0].id)?.height), pages: layout.pageCount, marks: p.tables[0].rows.map(r => r.cells.map(c => c.hideMark)) };
 }, [...bytes]);
}
test('shrinks hidden cell markers, keeps empty cells editable, and preserves declarations through export and undo', async ({ page }, info) => {
 const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/hidden-cell-mark.docx');
 const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^End-of-cell marker height/); const original = await input.inputValue(), source = readFileSync('public/fixtures/hidden-cell-mark.docx'), before = await geometry(page, source);
 expect(createHash('sha256').update(source).digest('hex')).toBe(word.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/hidden-cell-mark/native-spacing.pdf')).digest('hex')).toBe(word.pdfSha256);
 // The native reference supplies an 8pt paragraph after-gap and 278/240 multiple when styles are absent.
 const afterGap = 8 * 4 / 3;
 expect(before.rows[0] - afterGap).toBeGreaterThan((before.rows[1] - afterGap) * 4); expect(before.rows[2]).toBeCloseTo(4);
 expect(Math.abs(before.rows[6]*.75-word.pictureRowHeight)).toBeLessThan(.15);
 writeFileSync(info.outputPath('hidden-cell-mark.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
 // Tab from the small-text cell visits its empty neighbor, then the empty
 // minimum-height row. Its stored large typing format remains available.
 await select(input, 'Marker excluded'); await input.press('Tab'); await input.press('Tab'); await expect(page.getByLabel('Font size (pt)')).toHaveValue('36'); await page.keyboard.insertText('New cell text');
 const grown = readFileSync(await download(page, info, 'hidden-cell-mark-grown.docx')); expect((await geometry(page, grown)).rows[2]).toBeGreaterThan(before.rows[2]);
 await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
 const restored = unzipSync(readFileSync(await download(page, info, 'hidden-cell-mark-undo.docx'))), parts = unzipSync(source); for (const [name, bytes] of Object.entries(parts)) expect(Buffer.from(restored[name]).equals(Buffer.from(bytes)), name).toBe(true);
 await select(input, 'Marker excluded'); const copied = await input.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return data.getData('text/plain'); }); expect(copied).toBe('Marker excluded');
 await input.evaluate(el => { const data = new DataTransfer(); data.setData('text/plain', 'Changed small text'); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
 const saved = await download(page, info, 'hidden-cell-mark.docx'); await reopenDocx(page, input, saved, original.replace('Marker excluded', 'Changed small text'));
 const after = await geometry(page, readFileSync(saved)); expect(after).toEqual(before); expect(errors).toEqual([]);
});
