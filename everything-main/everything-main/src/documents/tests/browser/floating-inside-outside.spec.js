import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/aligned-multipage-floating/';
test.setTimeout(120000);
for (const zoom of [1, .75]) for (const name of ['single-page', 'control']) test(`${name}: preserve page-relative floating tables at ${zoom * 100}%`, async ({ page }, info) => {
  const bytes = readFileSync(folder + name + '.docx'), short = name === 'single-page';
  const native = JSON.parse(readFileSync(folder + (short ? 'single-page-reference.json' : 'reference.json')));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  await page.goto('/playground.html');
  const opened = await page.evaluate(async ({ bytes, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes));
    const host = document.createElement('div'); document.body.append(host);
    window.floatPkg = pkg; window.floatErrors = [];
    const e = window.floatEditor = new CanvasEditor(host, { ...pkg, images, onError: error => window.floatErrors.push(error.message) });
    e.setZoom(zoom);
    return { pages: e.layout.pages.length, tables: pkg.tables.length, readOnly: e.readOnly,
      approximations: e.layout.floatingTableApproximations?.length || 0,
      lines: e.layout.lines.map(l => ({ page: l.page, text: l.fragments.map(f => f.text || '').join('').replace(/\s/g, ''), x: l.fragments[0]?.x * .75, y: l.baseline * .75 })) };
  }, { bytes: [...bytes], zoom });
  expect(opened.tables).toBe(5); expect(opened.pages).toBe(short ? 5 : 10);
  expect(opened.readOnly).toBe(false); expect(opened.approximations).toBe(0);
  for (const row of native.lines.filter(l => /row\d+$/.test(l.text))) {
    const actual = opened.lines.filter(l => l.text === row.text); expect(actual).toHaveLength(1);
    expect(actual[0].page).toBe(row.page);
    // Existing native floating alignment has a sub-point frame/pen difference.
    // This bounded holdout does not certify complete native border/glyph ink.
    expect(Math.abs(actual[0].x - row.x), row.text).toBeLessThan(.35);
    expect(Math.abs(actual[0].y - row.y), row.text).toBeLessThan(.15);
  }
  const exportBytes = () => page.evaluate(async () => {
    const e = window.floatEditor, m = e.model;
    return [...new Uint8Array(await window.floatPkg.export(m.paragraphs, m.pageSettings, m.numbering, m.styles, m.tables, m.assets).arrayBuffer())];
  });
  {
    const noedit = Uint8Array.from(await exportBytes()); expect(unzipSync(noedit)).toEqual(unzipSync(bytes));
    writeFileSync(info.outputPath('noedit.docx'), noedit);
  }
  const printed = await page.evaluate(async () => {
    const e = window.floatEditor;
    const hashes = async cs => Promise.all(cs.map(async c => [...new Uint8Array(await crypto.subtle.digest('SHA-256', c.getContext('2d').getImageData(0, 0, c.width, c.height).data))].map(n => n.toString(16).padStart(2, '0')).join('')));
    const before = await hashes(e.canvases), sheets = e.printSheets(), pixels = await hashes(sheets), after = await hashes(e.canvases);
    return { before, after, pixels };
  });
  expect(printed.after).toEqual(printed.before); expect(printed.pixels).toHaveLength(short ? 5 : 10);
  {
    await page.evaluate(() => { const e = window.floatEditor; e.model.select(0); e.execute(() => e.model.replace('Edited ')); });
    const edited = Uint8Array.from(await exportBytes()); writeFileSync(info.outputPath('edited.docx'), edited);
    for (const [part, original] of Object.entries(unzipSync(bytes))) if (part !== 'word/document.xml') expect(unzipSync(edited)[part]).toEqual(original);
    const reopened = await page.evaluate(async bytes => {
      const { openCanvasDocument } = await import('/src/engine/open-document.js');
      const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
      const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes)), host = document.createElement('div'); document.body.append(host);
      const e = new CanvasEditor(host, { ...pkg, images });
      try { return { readOnly: e.readOnly, pages: e.layout.pages.length, tables: pkg.tables.length, text: e.model.text }; }
      finally { e.destroy(); host.remove(); }
    }, [...edited]);
    expect(reopened.readOnly).toBe(false); expect(reopened.pages).toBe(short ? 5 : 10); expect(reopened.tables).toBe(5); expect(reopened.text).toMatch(/^Edited /);
    await page.evaluate(() => window.floatEditor.undo());
    const undone = Uint8Array.from(await exportBytes()); expect(unzipSync(undone)).toEqual(unzipSync(bytes)); writeFileSync(info.outputPath('undo.docx'), undone);
    const undoPixels = await page.evaluate(async () => Promise.all(window.floatEditor.printSheets().map(async c => [...new Uint8Array(await crypto.subtle.digest('SHA-256', c.getContext('2d').getImageData(0, 0, c.width, c.height).data))].map(n => n.toString(16).padStart(2, '0')).join(''))));
    expect(undoPixels).toEqual(printed.pixels);
  }
  expect(await page.evaluate(() => window.floatErrors)).toEqual([]);
});
