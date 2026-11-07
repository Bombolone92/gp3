// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeBytes(wb) {
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/workbook.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  entry.size = entry.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const linked = { v: 'Bold plain', hyperlink: 'https://example.com/details', richText: [
  { text: 'Bold', s: { bold: true } }, { text: ' plain', s: { bold: false } },
] };
it('keeps rich native hyperlinks as string values through metadata-free XLSX round trips', async () => {
  let wb = new Workbook({ sheets: [{ name: 'Links', cells: { '0,0': linked, '1,0': { f: 'ISFORMULA(A1)' } } }] });
  for (let round = 0; round < 2; round++) {
    const bytes = await nativeBytes(wb), native = X.read(bytes, { type: 'array' }).Sheets.Links.A1;
    expect(native.f).toBeUndefined();
    expect(native.r).toContain('<rPr>');
    expect(native.l.Target).toBe(linked.hyperlink);
    wb = await workbookFromFile(bytes, 'native-links.xlsx');
    const cell = wb.getCell(wb.activeSheetId, 0, 0);
    expect(cell).toMatchObject({ v: linked.v, f: null, hyperlink: linked.hyperlink });
    expect(cell.richText.map(run => [run.text, run.s.bold])).toEqual([['Bold', true], [' plain', false]]);
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(false);
  }
});

it('preserves calculated values and rich styles when removing attached links, with Undo', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': linked, '1,0': { f: '1+2', hyperlink: linked.hyperlink } } }] }), id = wb.activeSheetId;
  wb.removeLink(id, 0, 0);
  expect(wb.getCell(id, 0, 0).richText).toEqual(linked.richText);
  expect(wb.linkAt(id, 0, 0)).toBeNull();
  wb.undo(); expect(wb.linkAt(id, 0, 0).url).toBe(linked.hyperlink);
  wb.removeLink(id, 1, 0);
  expect(wb.getCell(id, 1, 0).f).toBe('1+2');
  expect(wb.getValue(id, 1, 0)).toBe(3);
  expect(wb.linkAt(id, 1, 0)).toBeNull();
});

it('does not freeze a HYPERLINK formula to its exported cached relationship', async () => {
  let wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'https://example.com/old' }, '0,1': { f: 'HYPERLINK(A1,"Go")' } } }] });
  wb = await workbookFromFile(await nativeBytes(wb), 'dynamic-link.xlsx');
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'https://example.com/new');
  expect(wb.getCell(id, 0, 1).hyperlink).toBeUndefined();
  expect(wb.linkAt(id, 0, 1)).toEqual({ url: 'https://example.com/new', label: 'Go' });
});

it.each(['B1', 'IF(B1>0,B1,0)', 'SUM({1,2;3,4})+B1'])('keeps a HYPERLINK label expression live when editing its address: %s', expression => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { f: `HYPERLINK("https://example.com/old",${expression})` }, '0,1': { v: 5 } } }] }), id = wb.activeSheetId;
  const before = wb.getValue(id, 0, 0);
  wb.setLink(id, 0, 0, 'https://example.com/new', before);
  expect(wb.getCell(id, 0, 0).f).toBe(`HYPERLINK("https://example.com/new",${expression})`);
  wb.setInput(id, 0, 1, '9');
  expect(wb.getValue(id, 0, 0)).toBe(before + 4);
  expect(wb.linkAt(id, 0, 0).url).toBe('https://example.com/new');
});


it('materializes the inherited cell font in a partially formatted exported run', async () => {
  const wb = new Workbook({ normalFont: { name: 'Trebuchet MS', sz: 15, color: '#556677' }, sheets: [{ cells: {
    '0,0': { v: 'ab', s: { bold: true, italic: true, size: 28 }, richText: [{ text: 'a', s: { color: '#123456' } }, { text: 'b' }] },
  } }] });
  const native = X.read(await nativeBytes(wb), { type: 'array' }).Sheets[wb.activeSheet.name].A1;
  expect(native.r).toContain('<rFont val="Trebuchet MS"/>');
  expect(native.r).toContain('<sz val="21"/>');
  expect(native.r).toContain('<b val="1"/>');
  expect(native.r).toContain('<i val="1"/>');
  const back = await workbookFromFile(await nativeBytes(wb), 'partial-font.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 0).richText[0].s).toMatchObject({ bold: true, italic: true, size: 28, font: 'trebuchet', color: '#123456' });
});

it('attaches links without changing unchanged rich labels or calculations', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': linked, '1,0': { f: '1+2' } } }] }), id = wb.activeSheetId;
  wb.setLink(id, 0, 0, 'https://example.com/new', linked.v);
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: linked.v, richText: linked.richText, hyperlink: 'https://example.com/new' });
  wb.setLink(id, 1, 0, linked.hyperlink, 3);
  expect(wb.getCell(id, 1, 0).f).toBe('1+2');
  expect(wb.linkAt(id, 1, 0)).toEqual({ url: linked.hyperlink, label: '3' });
  wb.undo(); expect(wb.getCell(id, 1, 0).hyperlink).toBeUndefined();
  expect(wb.getValue(id, 1, 0)).toBe(3);
  wb.setInput(id, 0, 0, 'Bold plains', { preserveRichText: true });
  expect(wb.getCell(id, 0, 0).hyperlink).toBe('https://example.com/new');
  expect(wb.getCell(id, 0, 0).richText.map(run => [run.text, run.s.bold])).toEqual([['Bold', true], [' plains', false]]);
});

it('keeps native links through copy and JSON, and follows sheet renames with Undo', () => {
  const wb = new Workbook({ sheets: [{ name: "O'Brien", cells: { '0,0': { ...linked, hyperlink: "#'O''Brien'!B2" } } }] }), id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }), 1, 0);
  expect(wb.getCell(id, 1, 0)).toEqual(wb.getCell(id, 0, 0));
  expect(new Workbook(wb.toJSON()).getCell(id, 0, 0)).toEqual(wb.getCell(id, 0, 0));
  wb.renameSheet(id, 'New Sheet');
  expect(wb.getCell(id, 0, 0).hyperlink).toBe("#'New Sheet'!B2");
  expect(wb.resolveLink(wb.linkAt(id, 0, 0).url, id)).toEqual({ sheetId: id, range: { r1: 1, c1: 1, r2: 1, c2: 1 } });
  wb.undo(); expect(wb.getCell(id, 0, 0).hyperlink).toBe("#'O''Brien'!B2");
  wb.redo(); expect(wb.getCell(id, 0, 0).hyperlink).toBe("#'New Sheet'!B2");
  const duplicate = wb.duplicateSheet(id);
  expect(wb.resolveLink(wb.linkAt(duplicate.id, 0, 0).url, duplicate.id)?.sheetId).toBe(duplicate.id);
});

it('updates named destinations on protected cells without allowing user link edits', () => {
  const wb = new Workbook({ sheets: [{ name: 'Main', cells: { '0,0': { ...linked, hyperlink: '#Target' } } }] }), id = wb.activeSheetId;
  wb.defineName('Target', 'Main!$B$2');
  wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 });
  expect(wb.setLink(id, 0, 0, '#Elsewhere', linked.v)).toBe(false);
  expect(wb.renameName('Target', null, 'Destination', 'Main!$B$2')).toBeNull();
  expect(wb.getCell(id, 0, 0)).toMatchObject({ hyperlink: '#Destination', richText: linked.richText });
  wb.undo(); expect(wb.getCell(id, 0, 0).hyperlink).toBe('#Target');
  wb.redo(); expect(wb.getCell(id, 0, 0).hyperlink).toBe('#Destination');
});

it('expands a table for a new linked label but not for a link attached to unchanged content', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Item' }, '1,0': { v: 'First' }, '2,0': { v: 'Existing' } } }] }), id = wb.activeSheetId;
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 });
  wb.setLink(id, 2, 0, linked.hyperlink, 'Existing');
  expect(wb.tableById(id, tid).range.r2).toBe(1);
  wb.setLink(id, 2, 0, linked.hyperlink, 'New label');
  expect(wb.tableById(id, tid).range.r2).toBe(2);
  wb.undo();
  expect(wb.tableById(id, tid).range.r2).toBe(1);
  expect(wb.getCell(id, 2, 0)).toMatchObject({ v: 'Existing', hyperlink: linked.hyperlink });
});
