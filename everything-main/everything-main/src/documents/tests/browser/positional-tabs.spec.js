import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const source = 'tests/fixtures/positional-tabs/source.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/positional-tabs/reference.json'));
const cases = JSON.parse(readFileSync('tests/fixtures/positional-tabs/cases.json'));

for (const name of ['contexts', 'contexts-autofit']) test(`matches positional tabs in headers, footers, cells, columns and repeated fields: ${name}`, async ({ page }, info) => {
  test.setTimeout(120000); await page.goto('/playground.html');
  const ref = JSON.parse(readFileSync(`tests/fixtures/positional-tabs/${name}-reference.json`));
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const host = document.createElement('div'); document.body.append(host); const editor = new CanvasEditor(host, pkg);
    try {
      return editor.layout.pages.map((_, i) => [...editor.storyLayout.lines, ...editor.layout.lines].filter(l => l.page === i)
        .flatMap((l, row) => l.fragments.filter(f => f.image).map(f => ({ x: f.x * .75, width: f.width * .75, row }))));
    } finally { editor.destroy(); host.remove(); }
  }, [...readFileSync(`tests/fixtures/positional-tabs/${name}.docx`)]);
  writeFileSync(info.outputPath('contexts-geometry.json'), JSON.stringify(result));
  expect(result).toHaveLength(3);
  const alignments = [
    ['center', 'right', 'left', 'center', 'right', 'left', 'center', 'right', 'center', 'right'],
    ['center', 'right', 'left', 'left', 'center', 'center', 'right', 'right'],
    ['center', 'right', 'left', 'center', 'right', 'left', 'center', 'right'],
  ];
  for (const [i, markers] of result.entries()) {
    expect(markers).toHaveLength(ref.pages[i].length);
    for (const [j, alignment] of alignments[i].entries()) {
      const [gray, red, blue] = markers.slice(j * 3, j * 3 + 3), [wg, wr, wb] = ref.pages[i].slice(j * 3, j * 3 + 3);
      const anchor = (r, b) => ({ left: r.x, center: (r.x + b.x + b.width) / 2, right: b.x + b.width })[alignment];
      expect(Math.abs(anchor(red, blue) - anchor(wr, wb)), `page ${i + 1} field ${j} ${alignment}`).toBeLessThan(.05);
      expect(gray.row !== red.row, `page ${i + 1} field ${j} wrap`).toBe(wg.y !== wr.y);
    }
  }
});

test('matches native positional-tab anchors and line breaks with browser shaping', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, pkg);
    try {
      return editor.layout.pages.map((_, i) => editor.layout.lines.filter(l => l.page === i).flatMap((l, row) =>
        l.fragments.filter(f => f.image).map(f => ({ x: f.x * .75, width: f.width * .75, row }))));
    } finally { editor.destroy(); host.remove(); }
  }, [...readFileSync(source)]);
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(result));
  expect(result).toHaveLength(reference.pages.length);
  for (const [i, c] of cases.entries()) {
    const [red, blue] = result[i].slice(-2);
    const anchor = { left: red.x, center: (red.x + blue.x + blue.width) / 2, right: blue.x + blue.width }[c.alignment];
    expect(Math.abs(anchor - reference.pages[i].alignmentAnchor), c.name).toBeLessThan(.05);
    if (c.lead) expect(result[i][0].row !== red.row, c.name + ' wrap').toBe(reference.pages[i].markers['777777'].y !== reference.pages[i].markers.e03040.y);
  }
});

test('edits and reopens positional tabs without changing untouched package parts', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^margin-left-False/); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  await expect(page.locator('canvas.canvas-page')).toHaveCount(60);
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  const unchanged = (path, edited = false) => {
    const result = unzipSync(readFileSync(path)); if (edited) return expectBodyEditParts(result, parts); expect(Object.keys(result).sort()).toEqual(Object.keys(parts).sort());
    for (const n in parts) if (!edited || n !== 'word/document.xml') expect(Buffer.from(result[n]).equals(Buffer.from(parts[n])), n).toBe(true);
  };
  unchanged(await save('noedit'));
  await input.evaluate(el => { const at = el.value.indexOf('\t') + 1; el.focus(); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.keyboard.insertText('Edit'); const editedText = await input.inputValue(), edited = await save('edited'); unchanged(edited, true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); unchanged(await save('undo'));
  await reopenDocx(page, input, edited, editedText); await expect(input).toHaveJSProperty('readOnly', false);
  expect(errors).toEqual([]);
});
