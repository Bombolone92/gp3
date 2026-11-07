import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const select = (input, text) => input.evaluate((el, text) => { const at = el.value.indexOf(text); el.focus(); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select')); }, text);
const download = async (page, info, name) => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name); await (await pending).saveAs(path); return path; };
async function geometry(page, bytes) {
 return page.evaluate(async bytes => {
  const { DocxPackage } = await import('/src/engine/docx.js');
  const { layoutDocument } = await import('/src/engine/layout.js');
  const { pageGeometry } = await import('/src/engine/page-settings.js');
  const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
  const p = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(p);
  const ctx = document.createElement('canvas').getContext('2d');
  const layout = layoutDocument(p.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(p.pageSettings), p.numbering, p.tables);
  return { pages: layout.pageCount, firstPageTableBottom: Math.max(0, ...layout.cells.filter(c => c.page === 0).map(c => c.y + c.height)), tables: p.tables.map(t => ({ grid: t.grid.map(w => w / 15), widths: layout.tableWidths[t.id] })), text: p.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n') };
 }, [...bytes]);
}
test('preserves feasible merged widths, reflows oversized text, pastes and reopens without rewriting preferences', async ({ page }, info) => {
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 const source = readFileSync('public/fixtures/merged-autofit.docx'); await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/merged-autofit.docx');
 const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^Merged width preferences/);
 const before = await geometry(page, source); for (const table of before.tables) table.widths.forEach((w, i) => expect(w).toBeCloseTo(table.grid[i]));
 writeFileSync(info.outputPath('merged-autofit.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
 await select(input, 'x'.repeat(20)); const copied = await input.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return data.getData('text/plain'); }); expect(copied).toBe('x'.repeat(20));
 await page.keyboard.insertText('W'.repeat(40)); const grown = readFileSync(await download(page, info, 'merged-autofit-grown.docx'));
 expect((await geometry(page, grown)).tables[0].widths).not.toEqual(before.tables[0].widths);
 await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(before.text);
 const restored = unzipSync(readFileSync(await download(page, info, 'merged-autofit-undo.docx'))), original = unzipSync(source); for (const [name, bytes] of Object.entries(original)) expect(Buffer.from(restored[name]).equals(Buffer.from(bytes)), name).toBe(true);
 await select(input, 'Side'); await input.evaluate(el => { const data = new DataTransfer(); data.setData('text/plain', 'Revised'); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
 const saved = await download(page, info, 'merged-autofit.docx'); await reopenDocx(page, input, saved, before.text.replace('Side', 'Revised'));
 const after = await geometry(page, readFileSync(saved)); expect(after.tables).toEqual(before.tables); expect(errors).toEqual([]);
});
test('retains the first local card’s feasible saved columns through a DOCX round trip', async ({ page }, info) => {
 test.skip(!process.env.BIRTHDAY_CARD_PATH, 'Optional private local corpus specimen');
 const source = readFileSync(process.env.BIRTHDAY_CARD_PATH); await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(process.env.BIRTHDAY_CARD_PATH);
 const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/Happy Birthday/);
 const before = await geometry(page, source); for (const table of before.tables) table.widths.forEach((w, i) => expect(w).toBeCloseTo(table.grid[i]));
 await select(input, 'From:'); await page.keyboard.insertText('Sender:'); const saved = await download(page, info, 'birthday-autofit.docx'); await reopenDocx(page, input, saved, before.text.replace('From:', 'Sender:'));
 const after = await geometry(page, readFileSync(saved)); expect(after.tables).toEqual(before.tables);
 writeFileSync(info.outputPath('birthday-autofit-geometry.json'), JSON.stringify(before, null, 2));
});
