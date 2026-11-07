import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source = 'public/fixtures/nested-floating-tables.docx';
const folder = 'tests/fixtures/nested-floating-tables';
const reference = JSON.parse(readFileSync(`${folder}/native-geometry.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, 'utf8'));

test('places and wraps nested floating tables against eighteen native reference controls', async ({ page }, info) => {
  test.setTimeout(120000);
  for (const [name, hash] of Object.entries(manifest.sha256)) {
    expect(createHash('sha256').update(readFileSync(name.endsWith('.docx') ? source : `${folder}/${name}`)).digest('hex')).toBe(hash);
  }
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument, hitTest, caretRect } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(p);
    const ctx = document.createElement('canvas').getContext('2d');
    const l = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    return { pages: l.pageCount, frames: l.floatingTables, cases: Array.from({ length: l.pageCount }, (_, i) => {
      const cells = l.cells.filter(c => c.page === i), outer = cells.filter(c => c.depth === 1);
      return { outer: outer.map(c => ({ x: c.x * .75, y: c.y * .75 })),
        fills: cells.filter(c => c.depth === 2).sort((a, b) => a.x - b.x).map(c => ({ x: c.x * .75, y: c.y * .75, width: c.width * .75, height: c.height * .75 })),
        lines: l.lines.filter(line => line.page === i).map(line => {
          const cell = cells.find(c => c.id === line.cellId);
          const hit = cell?.depth === 2 ? hitTest(l, i, line.stops[0].x + .1, line.y + line.height / 2) : null;
          return { text: line.fragments.map(f => f.text || '').join(''), y: line.baseline * .75,
            fragments: line.fragments.map(f => ({ text: f.text, x: f.x * .75 })), depth: cell?.depth,
            hit, start: line.start, caretPage: hit == null ? null : caretRect(l, hit).page };
        }) };
    }) };
  }, readFileSync(source).toString('base64'));
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(actual, null, 2));
  expect(actual.pages).toBe(18); expect(actual.frames).toHaveLength(17);
  for (let i = 0; i < 18; i++) {
    const observed = actual.cases[i], native = reference[i];
    expect(observed.fills).toHaveLength(2);
    // An existing legacy top-level table offset is independent of this feature.
    // Compare nested X relative to the same parent's inline control; keep Y,
    // dimensions, line flow, and hit testing in absolute page coordinates.
    const shift = observed.fills[0].x - native.fills[0].x;
    for (let j = 0; j < 2; j++) for (const key of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(observed.fills[j][key] - (key === 'x' ? shift : 0) - native.fills[j][key]), `case ${i}, fill ${j}, ${key}`).toBeLessThan(.15);
    }
    const nativeText = native.characters.map(c => c.text).join('');
    for (const text of ['Before nested 1', 'After nested 1', 'Following outer table']) {
      const line = observed.lines.find(l => l.text === text);
      expect(line, `case ${i}, ${text}`).toBeTruthy();
      const start = nativeText.indexOf(text); expect(start).toBeGreaterThanOrEqual(0);
      expect(Math.abs(line.y - native.characters[start].y), `case ${i}, ${text} baseline`).toBeLessThan(.12);
      let offset = 0;
      for (const fragment of line.fragments) {
        if (fragment.text?.trim()) expect(Math.abs(fragment.x - (text === 'Following outer table' ? 0 : shift) - native.characters[start + offset].x), `case ${i}, ${text}, ${fragment.text} origin`).toBeLessThan(.15);
        offset += fragment.text?.length || 0;
      }
    }
    for (const line of observed.lines.filter(l => l.depth === 2)) {
      expect(line.hit).toBe(line.start); expect(line.caretPage).toBe(i);
    }
  }
});

test('edits a floated child and retains its positioning and unrelated package parts through undo and reopen', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Nested positioning case 0/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(18);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const next = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await next).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const anchor = original.indexOf('Nested positioning case 1\n');
  const start = original.indexOf('Nested text', original.indexOf('Before nested 1', anchor));
  expect(start).toBeGreaterThan(anchor);
  await input.evaluate((e, start) => { e.focus(); e.setSelectionRange(start, start); e.dispatchEvent(new Event('select')); }, start);
  await page.keyboard.insertText('Edit ');
  await expect(input).toHaveValue(original.slice(0, start) + 'Edit ' + original.slice(start));
  const editedText = await input.inputValue(), edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expectBodyEditParts(changed, parts);
  const positions = bytes => new TextDecoder().decode(bytes).match(/<w:tblpPr\b[^>]*\/>/g);
  expect(positions(changed['word/document.xml'])).toEqual(positions(parts['word/document.xml']));
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  const previous = await input.elementHandle(); page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(edited);
  await page.waitForFunction(el => !el.isConnected, previous, { timeout: 60000 }); await previous.dispose();
  await expect(input).toHaveValue(editedText);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(18);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
