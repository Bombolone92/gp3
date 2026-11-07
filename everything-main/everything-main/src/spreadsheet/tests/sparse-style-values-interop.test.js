import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxResetCells } from '../src/core/xlsx-style-resets.js';
import * as X from '../src/vendor/xlsx.mjs';

const values = { br: true, brBorder: { bs: 'double', bc: '#225599' }, bg: '#f0e0cc', bold: false, color: '#663399' };
const book = () => new Workbook({ normalFont: { name: 'Arial', sz: 11, bold: true }, sheets: [{ name: 'Values',
  styleResets: [{ range: { r1: 3, c1: 2, r2: 6, c2: 4 }, keys: Object.keys(values), values }],
  cells: { '4,3': { v: 8 }, '5,3': { f: 'D5*2' }, '1,15': { v: 'Replacement format', s: { bt: true, bs: 'dashed', bc: '#bb3300' } } },
}] });
const partText = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
function setPart(zip, path, value) { const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(value); part.size = part.content.length; }
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
async function zipFor(wb) { return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
const side = (style, key) => style?.[key] ? style[`${key}Border`] || { bs: style.bs || 'thin', bc: style.bc || '#000000' } : null;

it.each([false, true])('exports concrete sparse values as native blank XFs and keeps repeated saves stable (native-only=%s)', async nativeOnly => {
  let wb = book(); const source = wb.toJSON();
  for (let save = 0; save < 2; save++) {
    const zip = await zipFor(wb);
    if (!save) expect(wb.toJSON()).toEqual(source);
    if (nativeOnly) setPart(zip, '/xl/workbook.xml', partText(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    wb = await workbookFromFile(bytes(zip), 'values.xlsx');
    for (let r = 3; r <= 6; r++) for (let c = 2; c <= 4; c++) {
      const style = wb.styleAt(wb.activeSheetId, r, c);
      expect(side(style, 'br')).toEqual(values.brBorder);
      expect(style).toMatchObject({ bg: values.bg, bold: false, color: values.color });
    }
    expect(wb.getValue(wb.activeSheetId, 5, 3)).toBe(16);
    expect(wb.styleAt(wb.activeSheetId, 7, 3)?.br).toBeFalsy();
  }
});

it('accepts native edits and No Border instead of reviving private sparse border values', async () => {
  const zip = await zipFor(book()), path = '/xl/worksheets/sheet1.xml';
  let xml = partText(zip, path);
  const replacement = xml.match(/<c\b[^>]*\br="P2"[^>]*\bs="(\d+)"/)[1];
  xml = xml.replace(/(<c\b[^>]*\br="D5"[^>]*\bs=")\d+"/, `$1${replacement}"`)
    .replace(/(<c\b[^>]*\br="D6"[^>]*\bs=")\d+"/, (_, prefix) => `${prefix}0"`);
  setPart(zip, path, xml);
  const wb = await workbookFromFile(bytes(zip), 'edited.xlsx'), id = wb.activeSheetId;
  expect(side(wb.styleAt(id, 4, 3), 'bt')).toEqual({ bs: 'dashed', bc: '#bb3300' });
  expect(side(wb.styleAt(id, 4, 3), 'br')).toBeNull();
  expect(side(wb.styleAt(id, 5, 3), 'br')).toBeNull();
  expect(side(wb.styleAt(id, 6, 3), 'br')).toEqual(values.brBorder);
  expect(wb.getValue(id, 5, 3)).toBe(16);
});

it('omits native no-op values and compares nested border values by meaning', () => {
  const style = { br: true, brBorder: { bs: 'double', bc: '#225599' } };
  const sheet = { colStyles: new Map([[2, style]]), rowStyles: new Map(),
    styleResets: [{ range: { r1: 0, c1: 2, r2: 1048575, c2: 2 }, keys: Object.keys(style), values: structuredClone(style) }] };
  expect([...xlsxResetCells(sheet)]).toEqual([]);
});
