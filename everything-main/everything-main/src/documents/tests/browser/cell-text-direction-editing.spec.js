import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const folder = 'tests/fixtures/cell-text-direction';
test('matches native style-direction compatibility and round-trips rotated edits', async ({ page }, info) => {
  const reference = JSON.parse(readFileSync(`${folder}/styles-reference.json`));
  for (const [file, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
  const native = reference.pages.map(p => p.runs.filter(r => /^R\dC\d$/.test(r.text.trim())));
  expect(native).toHaveLength(4);
  // The native reference ignores all three style forms, while retaining direct overrides.
  for (const runs of native.slice(0, 3)) expect(runs.map(r => Math.abs(r.tm[1]) > .9)).toEqual([false, false, false, true, false, false]);
  expect(native[3].map(r => Math.abs(r.tm[1]) > .9)).toEqual([true, false, false, true, true, true]);
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { cellTextPoint } = await import('/src/engine/cell-text-direction.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes));
    await loadCanvasFonts(pkg);
    const host = document.createElement('div'); host.id = 'direction-editing'; document.body.append(host);
    const editor = window.directionEditing = new CanvasEditor(host, pkg);
    window.directionPackage = pkg;
    const lines = editor.layout.lines.filter(line => line.cellId).map(physical => {
      const line = physical.cellText?.line || physical;
      const point = physical.cellText ? cellTextPoint(physical.cellText.matrix, line.stops[0].x, line.baseline) : { x: line.stops[0].x, y: line.baseline };
      return { page: physical.page, text: line.fragments.map(f => f.text).join('').trim(), x: point.x * .75, y: point.y * .75 };
    });
    const before = editor.model.text;
    const target = editor.layout.lines.find(line => line.cellText);
    editor.model.select(target.start, target.start); editor.focus();
    return { readOnly: editor.readOnly, pages: editor.layout.pageCount, lines, before, target: target.start, pngs: editor.canvases.map(c => c.toDataURL().split(',')[1]) };
  }, [...readFileSync(`${folder}/styles.docx`)]);
  expect(result.readOnly).toBe(false); expect(result.pages).toBe(4); expect(result.lines).toHaveLength(24);
  for (const line of result.lines) {
    const expected = native[line.page].find(r => r.text.trim() === line.text);
    expect(expected, line.text).toBeTruthy();
    expect(Math.abs(line.x - expected.tm[4]), `${line.page} ${line.text} x`).toBeLessThan(.15);
    expect(Math.abs(line.y - (reference.pages[line.page].height - expected.tm[5])), `${line.page} ${line.text} y`).toBeLessThan(.2);
  }
  result.pngs.forEach((data, i) => writeFileSync(info.outputPath(`page-${i + 1}.png`), Buffer.from(data, 'base64')));
  const input = page.locator('#direction-editing textarea');
  await input.press('ArrowDown');
  await page.keyboard.insertText('X');
  expect(await input.inputValue()).toBe(result.before.slice(0, result.target + 1) + 'X' + result.before.slice(result.target + 1));
  const exported = await page.evaluate(async () => {
    const e = window.directionEditing, p = window.directionPackage, d = e.model;
    const bytes = new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const reopened = await DocxPackage.open(bytes);
    return { bytes: [...bytes], text: new TextDocument(reopened.paragraphs, reopened.pageSettings, reopened.numbering, reopened.styles, reopened.tables).text };
  });
  expect(exported.text).toBe(await input.inputValue());
  writeFileSync(info.outputPath('edited.docx'), Buffer.from(exported.bytes));
  const parts = unzipSync(new Uint8Array(exported.bytes)), original = unzipSync(readFileSync(`${folder}/styles.docx`));
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name], name).toEqual(original[name]);
  await input.press('Control+z'); await expect(input).toHaveValue(result.before);
  const undo = await page.evaluate(async () => {
    const p = window.directionPackage, d = window.directionEditing.model;
    return [...new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer())];
  });
  writeFileSync(info.outputPath('undo.docx'), Buffer.from(undo));
  expect(unzipSync(new Uint8Array(undo))).toEqual(original);
  const inserted = await page.evaluate(async () => {
    const e = window.directionEditing, p = window.directionPackage, d = e.model;
    d.selectCell(d.tables[3].rows[0].cells[0].id);
    if (!e.execute(() => d.insertTableRow())) throw new Error('Row insertion failed');
    for (const cell of d.tableContext.row.cells) cell.shell = null;
    const bytes = new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
    const { DocxPackage } = await import('/src/engine/docx.js');
    const reopened = await DocxPackage.open(bytes);
    return { bytes: [...bytes], directions: reopened.tables[3].rows[1].cells.map(c => c.textDirection) };
  });
  expect(inserted.directions).toEqual(['tbRl', 'lrTb']);
  writeFileSync(info.outputPath('inserted-row.docx'), Buffer.from(inserted.bytes));
});

test('keeps unsupported rotated hidden marks read-only with original download', async ({ page }, info) => {
  const parts = unzipSync(readFileSync(`${folder}/control.docx`));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/(<w:textDirection w:val="btLr"\/>\s*<w:vAlign[^>]*\/>)/, '$1<w:hideMark/>'));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles({ name: 'hidden-rotation.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/top-exact/); await expect(input).toHaveJSProperty('readOnly', true);
  const before = await input.inputValue();
  await input.focus(); await page.keyboard.insertText('Must not change'); await expect(input).toHaveValue(before);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('original.docx'); await (await pending).saveAs(output);
  expect(unzipSync(readFileSync(output))).toEqual(parts);
});
