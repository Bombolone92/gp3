import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
for (const name of ['short-12', 'center-short-12', 'asymmetric-short-12']) {
const folder = `tests/fixtures/aligned-floating-anchor-matrix/${name}/`;
const bytes = readFileSync(folder + 'control.docx');
const native = JSON.parse(readFileSync(folder + 'reference.json'));
for (const zoom of [1, .75]) test(`${name}: legacy writing alignment at ${zoom * 100}%`, async ({ page }, info) => {
  test.setTimeout(120000);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async ({ bytes, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes)), host = document.createElement('div'); document.body.append(host);
    window.parityPkg = pkg; window.parityErrors = [];
    const e = window.parityEditor = new CanvasEditor(host, { ...pkg, images, onError: error => window.parityErrors.push(error.message) }); e.setZoom(zoom);
    return { pages: e.layout.pages.length, readOnly: e.readOnly, tables: pkg.tables.length,
      rows: e.layout.lines.map(l => ({ page: l.page, text: l.fragments.map(f => f.text || '').join('').replace(/\s/g, ''), x: l.fragments[0]?.x * .75, y: l.baseline * .75 })) };
  }, { bytes: [...bytes], zoom });
  expect(actual.readOnly).toBe(false); expect(actual.tables).toBe(4); expect(actual.pages).toBe(native.pages);
  for (const expected of native.lines.filter(l => /row\d+$/.test(l.text))) {
    const row = actual.rows.filter(l => l.text === expected.text); expect(row).toHaveLength(1);
    expect(row[0].page).toBe(expected.page);
    expect(Math.abs(row[0].x - expected.x)).toBeLessThan(.35);
    expect(Math.abs(row[0].y - expected.y)).toBeLessThan(.15);
  }
  const exported = () => page.evaluate(async () => {
    const e = window.parityEditor, m = e.model;
    return [...new Uint8Array(await window.parityPkg.export(m.paragraphs, m.pageSettings, m.numbering, m.styles, m.tables, m.assets).arrayBuffer())];
  });
  const initial = Uint8Array.from(await exported()); expect(unzipSync(initial)).toEqual(unzipSync(bytes)); writeFileSync(info.outputPath('noedit.docx'), initial);
  const initialPixels = await page.evaluate(() => window.parityEditor.printSheets().map(c => c.toDataURL()));
  await page.evaluate(() => {
    const e = window.parityEditor;
    for (const table of e.model.tables) { e.model.selectCell(table.rows[0].cells[0].id); e.execute(() => e.model.replace('Edited ')); }
  });
  const edited = Uint8Array.from(await exported()); writeFileSync(info.outputPath('edited.docx'), edited);
  for (const [name, original] of Object.entries(unzipSync(bytes))) if (name !== 'word/document.xml') expect(unzipSync(edited)[name]).toEqual(original);
  const editedPixels = await page.evaluate(() => window.parityEditor.printSheets().map(c => c.toDataURL()));
  const reopened = await page.evaluate(async bytes => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes)), host = document.createElement('div'); document.body.append(host);
    const e = new CanvasEditor(host, { ...pkg, images });
    try { return { pages: e.layout.pages.length, readOnly: e.readOnly, text: e.model.text, pixels: e.printSheets().map(c => c.toDataURL()) }; }
    finally { e.destroy(); host.remove(); }
  }, [...edited]);
  expect(reopened.pages).toBe(native.pages); expect(reopened.readOnly).toBe(false); expect((reopened.text.match(/Edited /g) || []).length).toBe(4); expect(reopened.pixels).toEqual(editedPixels);
  await page.evaluate(() => { for (let index = 0; index < 4; index++) window.parityEditor.undo(); });
  const undo = Uint8Array.from(await exported()); expect(unzipSync(undo)).toEqual(unzipSync(bytes)); writeFileSync(info.outputPath('undo.docx'), undo);
  expect(await page.evaluate(() => window.parityEditor.printSheets().map(c => c.toDataURL()))).toEqual(initialPixels);
  expect(await page.evaluate(() => window.parityErrors)).toEqual([]);
});

}
