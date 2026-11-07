import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const root = 'tests/fixtures/oversized-body-lines/';
const references = JSON.parse(readFileSync(root + 'reference.json')).records;
for (const name of ['fresh', 'preceded', 'consecutive', 'wrapped', 'explicit-break', 'large-spacing']) {
  test(`oversized body text retains native pagination and editable bounds: ${name}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const source = root + name + '.docx', bytes = readFileSync(source), ref = references[name];
    for (const [file, hash] of [[source, ref.sourceSha256], [root + name + '-native.pdf', ref.pdfSha256]]) {
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
    }
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/playground.html');
    const geometry = await page.evaluate(async base64 => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const { layoutDocument, caretRect, selectionRects } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const doc = await DocxPackage.open(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
      await loadCanvasFonts(doc);
      const context = document.createElement('canvas').getContext('2d');
      const layout = layoutDocument(doc.paragraphs, (t, s) => measureCanvasText(context, t, s), pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
      return { pages: layout.pageCount, lines: layout.lines.map(line => ({ page: line.page, text: line.fragments.map(f => f.text || '').join(''), x: line.stops[0].x * .75, baseline: line.baseline * .75 })),
        carets: layout.lines.flatMap(line => [caretRect(layout, line.start), caretRect(layout, line.end)]),
        selections: selectionRects(layout, 0, layout.lines.at(-1).end), heights: layout.pages.map(p => p.height) };
    }, bytes.toString('base64'));
    expect(geometry.pages).toBe(ref.pages.length);
    const expected = ref.pages.flatMap((p, page) => p.text.map(t => ({ ...t, page })));
    expect(geometry.lines.map(l => [l.page, l.text])).toEqual(expected.map(l => [l.page, l.text]));
    for (const [i, line] of geometry.lines.entries()) {
      expect(Math.abs(line.x - expected[i].x)).toBeLessThanOrEqual(.2);
      expect(Math.abs(line.baseline - expected[i].baseline)).toBeLessThanOrEqual(.2);
    }
    for (const rect of [...geometry.carets, ...geometry.selections]) {
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(geometry.heights[rect.page] + 1e-6);
    }
    const input = page.getByRole('textbox', { name: 'Document text' }), old = await input.elementHandle();
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    await page.waitForFunction(el => !el.isConnected, old); await old.dispose();
    await expect(input).toBeEditable(); await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
    const original = await input.inputValue(), parts = unzipSync(bytes);
    const save = async name => {
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
      const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path;
    };
    expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
    await input.focus(); await input.press('ControlOrMeta+End'); await page.keyboard.insertText(' edited');
    await expect(input).toHaveValue(original + ' edited');
    const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
    for (const [name, data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(data);
    await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
    expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
    await reopenDocx(page, input, edited, original + ' edited');
    await expect(input).toBeEditable(); await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages.length);
    expect(errors).toEqual([]);
  });
}
