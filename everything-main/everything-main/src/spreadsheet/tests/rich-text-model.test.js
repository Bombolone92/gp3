import { expect, it } from 'vitest';
import { Workbook, cloneCell } from '../src/core/workbook.js';
import { normalizeRichText, editRichText } from '../src/core/rich-text.js';
import { readXlsxRichText, richTextXml } from '../src/core/xlsx-rich-text.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { MAX_TEXT } from '../src/core/cell.js';

const cell = () => ({ v: 'Code — description', f: null, richText: [
  { text: 'Code', s: { bold: true, font: 'trebuchet', size: 16 } },
  { text: ' — description', s: { bold: false, italic: true, color: '#112233' } },
] });

it('clones run styles and retains them through Undo, copy, JSON and sheet duplication', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': cell() } }] }), id = wb.activeSheetId;
  const original = wb.getCell(id, 0, 0), copy = cloneCell(original);
  copy.richText[0].s.bold = false;
  expect(original.richText[0].s.bold).toBe(true);
  wb.pasteCells(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }), 1, 0);
  expect(wb.getCell(id, 1, 0).richText).toEqual(original.richText);
  wb.undo();
  expect(wb.getCell(id, 1, 0)).toBeUndefined();
  expect(new Workbook(wb.toJSON()).getCell(id, 0, 0).richText).toEqual(original.richText);
  expect(wb.duplicateSheet(id).cells.get('0,0').richText).toEqual(original.richText);
});

it('preserves unaffected runs for in-place edits and clears them for replacement input', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': cell() } }] }), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'CodeX — description', { preserveRichText: true });
  expect(wb.getCell(id, 0, 0).richText.map(r => [r.text, r.s.bold])).toEqual([['CodeX', true], [' — description', false]]);
  wb.undo();
  wb.setInput(id, 0, 0, 'Replacement');
  expect(wb.getCell(id, 0, 0).richText).toBeUndefined();
  wb.undo();
  wb.setInput(id, 0, 0, '=1+1', { preserveRichText: true });
  expect(wb.getCell(id, 0, 0).richText).toBeUndefined();
  wb.undo();
  expect(wb.getCell(id, 0, 0).richText).toEqual(cell().richText);
});

it.each([false, true])('pastes formulas without transferring rich fonts or hyperlinks, transpose=%s', transpose => {
  const source = { ...cell(), hyperlink: 'https://example.com/source' };
  const target = { ...cell(), s: { font: 'courier', size: 16, color: '#008800' }, hyperlink: 'https://example.com/target' };
  const wb = new Workbook({ sheets: [{ cells: { '2,3': target } }] }), id = wb.activeSheetId;
  wb.pasteCells(id, [[source]], 2, 3, null, null, { keepStyles: true, transpose });
  expect(wb.getCell(id, 2, 3)).toEqual({ v: source.v, f: null, s: target.s, hyperlink: target.hyperlink });
  wb.undo(); expect(wb.getCell(id, 2, 3).richText).toEqual(target.richText);
  wb.pasteCells(id, [[source]], 3, 4, null, null, { keepStyles: true, transpose });
  expect(wb.getCell(id, 3, 4).hyperlink).toBeUndefined();
  expect(wb.getCell(id, 3, 4).richText).toBeUndefined();
});

it('cell-wide font edits override only those character properties', () => {
  const wb = new Workbook({ sheets: [{ cells: { '0,0': cell() } }] }), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: false });
  const changed = wb.getCell(id, 0, 0);
  expect(!!wb.styleAt(id, 0, 0)?.bold).toBe(false);
  expect(changed.richText.every(r => !Object.hasOwn(r.s, 'bold'))).toBe(true);
  expect(changed.richText[1].s.italic).toBe(true);
  wb.undo();
  expect(wb.getCell(id, 0, 0).richText).toEqual(cell().richText);
});

it('rejects stale/malformed text and arbitrary non-font properties', () => {
  expect(normalizeRichText(cell().richText, 'different')).toBeNull();
  expect(normalizeRichText([{ text: 3 }], '3')).toBeNull();
  expect(normalizeRichText([{ text: 'a', s: { bg: '#ff0000', size: Infinity, font: 'font:Safe', bold: true } }], 'a'))
    .toEqual([{ text: 'a', s: { font: 'font:Safe', bold: true } }]);
  expect(editRichText([{ text: '😀', s: { bold: true } }, { text: 'x', s: { italic: true } }], '😀x', '😃x'))
    .toEqual([{ text: '😃', s: { bold: true } }, { text: 'x', s: { italic: true } }]);
});

it('encodes text and decodes each native run separately without inventing escapes', () => {
  const runs = [{ text: '_x00', s: { bold: true } }, { text: '41_ & < >\r\n😀', s: { italic: true, underline: 'double', vertAlign: 'superscript' } }];
  const text = runs.map(r => r.text).join('');
  const back = readXlsxRichText(richTextXml(runs), text);
  expect(back.map(r => r.text)).toEqual(runs.map(r => r.text));
  expect(back[1].s).toMatchObject(runs[1].s);
});

it('writes run properties in the sequence required by Excel', () => {
  const xml = richTextXml([{ text: 'x', s: {
    bold: true, italic: false, strike: true, condense: false, extend: false,
    outline: true, shadow: true, underline: 'double', vertAlign: 'superscript',
    size: 20, color: '#123456', font: 'arial', family: 2, charset: 0, scheme: 'none',
  } }]);
  expect([...xml.matchAll(/<(\w+)\b[^>]*\/>/g)].map(match => match[1])).toEqual([
    'b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u',
    'vertAlign', 'sz', 'color', 'rFont', 'family', 'charset', 'scheme',
  ]);
});

it('uses Normal face and size but resets other omitted properties for nonempty native run fonts', () => {
  const xml = '<r><t>Cell</t></r><r><rPr/><t>Empty</t></r><r><rPr><color rgb="FF112233"/></rPr><t>Color</t></r>'
    + '<r><rPr><b val="0"/></rPr><t>Reset</t></r><r><rPr><rFont val="Courier New"/><sz val="9"/></rPr><t>Explicit</t></r>';
  const runs = readXlsxRichText(xml, 'CellEmptyColorResetExplicit', null, { name: 'Trebuchet MS', sz: 20, bold: true, strike: true, color: '#008800' });
  expect(runs[0]).toEqual({ text: 'CellEmpty' });
  expect(runs[1]).toMatchObject({ text: 'Color', s: { font: 'trebuchet', size: 20 * 4 / 3, color: '#112233', bold: false, strike: false } });
  expect(runs[2]).toMatchObject({ text: 'Reset', s: { font: 'trebuchet', size: 20 * 4 / 3, color: 'windowtext', bold: false, strike: false, vertAlign: 'baseline', scheme: 'none' } });
  expect(runs[3]).toMatchObject({ text: 'Explicit', s: { font: 'courier', size: 12, color: 'windowtext' } });
});

it('trims pasted rich text and formats together without splitting Unicode, with one notice and Undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId, events = [];
  wb.addEventListener('change', event => { if (event.detail.type === 'truncated') events.push(event.detail); });
  const richText = [{ text: 'Heading', s: { bold: true } },
    { text: 'x'.repeat(MAX_TEXT - 8), s: { italic: true } },
    { text: '😀tail', s: { color: '#123456' } }];
  const v = richText.map(run => run.text).join('');
  wb.pasteCells(id, [[{ v, richText }]], 2, 3);
  const kept = wb.getCell(id, 2, 3);
  expect(kept.v).toBe(v.slice(0, MAX_TEXT - 1));
  expect(kept.richText).toEqual(richText.slice(0, 2));
  expect(events).toEqual([{ type: 'truncated', sheetId: id, r: 2, c: 3, max: MAX_TEXT }]);
  wb.undo(); expect(wb.getCell(id, 2, 3)).toBeUndefined();
  wb.redo(); expect(wb.getCell(id, 2, 3)).toEqual(kept);
  // A matching retained prefix cannot conceal stale or malformed suffix runs.
  expect(normalizeRichText([...richText.slice(0, 2), { text: 'wrong' }], v, MAX_TEXT - 1)).toBeNull();
});

it('preserves the formatted prefix when exporting an oversized imported value', async () => {
  const richText = [{ text: 'x'.repeat(MAX_TEXT - 2), s: { bold: true } }, { text: '😀tail', s: { italic: true } }];
  const value = richText.map(run => run.text).join('');
  const wb = new Workbook({ sheets: [{ name: 'Long', cells: { '0,0': { v: value, richText } } }] });
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const native = X.read(bytes, { type: 'array' }).Sheets.Long.A1;
  expect(native.v).toBe(value.slice(0, MAX_TEXT));
  const runs = readXlsxRichText(native.r, native.v);
  expect(runs.map(run => run.text)).toEqual([richText[0].text, '😀']);
  expect(runs[0].s.bold).toBe(true);
  expect(runs[1].s.italic).toBe(true);
});

it('round-trips mixed text formats through native inline strings with no private metadata', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Rich', cells: { '0,0': cell() } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  expect(X.read(bytes, { type: 'array' }).Sheets.Rich.A1.r).toContain('<rPr>');
  const back = await workbookFromFile(bytes, 'rich.xlsx');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(cell().v);
  expect(back.getCell(back.activeSheetId, 0, 0).richText[0]).toMatchObject(cell().richText[0]);
  expect(back.getCell(back.activeSheetId, 0, 0).richText[1]).toMatchObject(cell().richText[1]);
});
