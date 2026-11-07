import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { showAllTools, onTab } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const source = 'tests/fixtures/column-bookmarks/merge-control.docx';
test('navigates to the covered column, edits, exports, undoes and reopens', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^PlainMiddle/); await expect(input).toBeEditable();
  const original = await input.inputValue();
  const go = async () => {
    await (await onTab(page, 'insert')).getByRole('button', { name: 'Bookmarks', exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Document bookmarks', exact: true });
    await expect(list.locator('option')).toHaveCount(12);
    const id = await list.locator('option').filter({ hasText: /^TopMergedSecond ·/ }).getAttribute('value');
    await list.selectOption(id);
    await page.getByRole('dialog').getByRole('button', { name: 'Go to bookmark', exact: true }).click();
    return input.evaluate(el => el.selectionStart);
  };
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  const parts = unzipSync(readFileSync(source));
  expect(unzipSync(readFileSync(await download('noedit')))).toEqual(parts);
  const at = original.indexOf('R1C3', original.indexOf('TopMergedSecond'));
  expect(await go()).toBe(at);
  await page.keyboard.insertText('Added ');
  const expected = original.slice(0, at) + 'Added ' + original.slice(at);
  await expect(input).toHaveValue(expected);
  const edited = await download('edited'), out = unzipSync(readFileSync(edited));
  expectBodyEditParts(out, parts);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await download('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, expected); expect(await go()).toBe(at);
  expect(errors).toEqual([]);
});

test('tracks vertical owners and a column endpoint inside a deleted nested table', async ({ page }, info) => {
  const geometry = readFileSync('tests/fixtures/column-bookmarks/geometry-control.docx');
  const parts = unzipSync(geometry), dom = new JSDOM(strFromU8(parts['word/document.xml']), { contentType: 'text/xml' });
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', xml = dom.window.document;
  const end = [...xml.getElementsByTagNameNS(w, 'bookmarkEnd')].find(n => n.getAttributeNS(w, 'id') === '3');
  const nested = [...xml.getElementsByTagNameNS(w, 'tbl')].find(n => n.parentElement.localName === 'tc');
  nested.parentNode.insertBefore(end, nested.nextSibling);
  parts['word/document.xml'] = strToU8(new dom.window.XMLSerializer().serializeToString(xml)); dom.window.close();
  const nestedSource = zipSync(parts); writeFileSync(info.outputPath('nested-end-source.docx'), nestedSource);
  await page.goto('/playground.html');
  for (const operation of ['split-vertical', 'delete-owner-row', 'delete-nested-end']) {
    const source = operation === 'delete-nested-end' ? nestedSource : geometry;
    const result = await page.evaluate(async ({ bytes, operation }) => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { TextDocument } = await import('/src/engine/model.js');
      const p = await DocxPackage.open(new Uint8Array(bytes));
      const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
      const d = model(p), name = operation === 'delete-nested-end' ? 'NestedMiddle' : 'VerticalMiddle';
      d.select(operation === 'delete-nested-end' ? d.text.indexOf('InnerA') : d.bookmarks.find(b => b.name === name).columnRange.target);
      if (operation === 'split-vertical') d.splitCell();
      else d.deleteTablePart(operation === 'delete-owner-row' ? 'row' : 'table');
      const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
      const edited = await save(), again = model(await DocxPackage.open(edited));
      const b = again.bookmarks.find(b => b.name === name), covered = b.columnRange.ranges.map(r => again.paragraphs.find(p => p.id === r.paragraphId).runs.map(r => r.text).join('')).join('\n');
      d.undo(); return { edited: [...edited], undo: [...await save()], covered, cells: b.columnRange.cellIds.length };
    }, { bytes: [...source], operation });
    expect(result.covered.match(/R\dC\d|Inner[AB]/g)).toEqual(operation === 'delete-nested-end' ? ['R1C2', 'R2C2'] : ['R1C2', 'R2C2', 'R3C2']);
    expect(result.cells).toBe(operation === 'split-vertical' ? 3 : 2);
    expect(unzipSync(new Uint8Array(result.undo))).toEqual(unzipSync(source));
    writeFileSync(info.outputPath(operation + '.docx'), Buffer.from(result.edited));
  }
});

test('exports column-bookmark table edits for independent native validation', async ({ page }, info) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const p = await DocxPackage.open(new Uint8Array(bytes)), results = [];
    for (const operation of ['insert-before', 'insert-inside', 'delete-before', 'delete-selected', 'insert-row', 'delete-row', 'merge', 'split']) {
      const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
      const b = d.bookmarks.find(b => b.name === (operation === 'split' ? 'TopMergedFirst' : 'PlainMiddle'));
      const table = d.tables.find(t => t.id === b.columnRange.tableId);
      d.select(b.columnRange.target);
      if (operation.endsWith('-before')) d.selectCell(table.rows[0].cells[0].id);
      if (operation.startsWith('insert-') && operation !== 'insert-row') d.insertTableColumn();
      if (operation.startsWith('delete-') && operation !== 'delete-row') d.deleteTablePart('column');
      if (operation === 'insert-row') d.insertTableRow();
      if (operation === 'delete-row') d.deleteTablePart('row');
      if (operation === 'merge') {
        const first = d.paragraphs.findIndex(p => p.cellId === table.rows[0].cells[0].id);
        const second = d.paragraphs.findIndex(p => p.cellId === table.rows[0].cells[1].id);
        d.select(d.paragraphOffset(first), d.paragraphOffset(second) + 1); d.mergeCells();
      }
      if (operation === 'split') d.splitCell();
      const data = new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
      const again = await DocxPackage.open(data);
      results.push({ operation, bytes: [...data], textMatches: again.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n') === d.text });
    }
    return results;
  }, [...readFileSync(source)]);
  for (const item of result) {
    expect(item.textMatches, item.operation).toBe(true);
    writeFileSync(info.outputPath(item.operation + '.docx'), Buffer.from(item.bytes));
  }
});
