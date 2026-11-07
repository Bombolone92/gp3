import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const values = [null, '', { f: '""' }, 0, '0', true, 'TRUE', false, 'FALSE', 'x', 'X', ' x ', 'x ', 'a*b', 'a?b', 'ab', 'acb', 'a~b', '>2', 3, 4, '2', '02', '2.0', 2, 2.0001, { f: '1/0' }, { f: '1/0' }, { f: 'NA()' }, 'NaN', '*', '?', '~', ' ', '  ', '\u00a0x\u00a0', '\u2000x\u2000', 'TRUE', 'FALSE', true, false, 'z', 'z', '007', 7, 'é', 'É', 'e'];
const range = { r1: 2, c1: 3, r2: values.length + 1, c2: 3 }, paint = { bg: '#b6e6ad', bold: true };
const look = (wb, r) => wb.conditionalStyle(wb.activeSheetId, r, 3, wb.getValue(wb.activeSheetId, r, 3));
async function save(wb, privateData) {
  const data = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(data, { type: 'array' });
  if (!privateData) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  }
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'duplicates.xlsx');
}
it.each(['dup', 'unique'])('preserves app %s identities in native export through edits, undo and repeated saves', async type => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, values.map((v, i) => ({ r: i + 2, c: 3, cell: v && typeof v === 'object' ? v : { v } })));
  wb.addRule(id, { type, range, style: paint });
  const expected = values.map((_, i) => look(wb, i + 2));
  for (const privateData of [false, true]) {
    let back = await save(wb, privateData);
    for (let pass = 0; pass < 2; pass++) {
      expect(back.activeSheet.rules).toHaveLength(1);
      expect(values.map((_, i) => look(back, i + 2))).toEqual(expected);
      back = await save(back, privateData);
    }
    back.setInput(back.activeSheetId, 19, 3, 'acb');
    expect(!!look(back, 18)).toBe(type === 'dup');
    back.undo(); expect(values.map((_, i) => look(back, i + 2))).toEqual(expected);
  }
});

it.each(['dup', 'unique'])('counts %s values across both dimensions with literal criteria and long text', async type => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const long = 'a?*>='.repeat(80), cells = [['x', ' x ', 'X', 'single'], [long, long.toUpperCase(), long + 'z', '>2'], ['*', '?', '~', '#DIV/0!']];
  wb.setCells(id, cells.flatMap((row, r) => row.map((v, c) => ({ r: r + 2, c: c + 3, cell: { v } }))));
  wb.addRule(id, { type, range: { r1: 2, c1: 3, r2: 4, c2: 6 }, style: paint });
  const back = await save(wb, false);
  for (let r = 2; r < 5; r++) for (let c = 3; c < 7; c++) {
    expect(back.conditionalStyle(back.activeSheetId, r, c, back.getValue(back.activeSheetId, r, c))).toEqual(wb.conditionalStyle(id, r, c, wb.getValue(id, r, c)));
  }
});

it('preserves duplicate priorities, stop behavior, editing and undo after row insertion', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [1, 1, 2].map((v, i) => ({ r: i + 2, c: 3, cell: { v } })));
  const g = { ...range, r2: 4 };
  wb.addRule(id, { type: 'dup', range: g, style: { bg: '#b6e6ad' }, stopIfTrue: false });
  wb.addRule(id, { type: 'gt', range: g, value: 0, style: { bg: '#ff0000', bold: true } });
  const back = await save(wb, false), sid = back.activeSheetId;
  expect(look(back, 2)).toEqual({ bg: '#b6e6ad', bold: true }); expect(look(back, 4)).toEqual({ bg: '#ff0000', bold: true });
  back.insertRows(sid, 0, 1); expect(look(back, 3)).toEqual({ bg: '#b6e6ad', bold: true });
  back.setInput(sid, 3, 3, '2'); expect(look(back, 3)).toEqual({ bg: '#b6e6ad', bold: true });
  expect(look(back, 4)).toEqual({ bg: '#ff0000', bold: true });
  back.undo(); back.undo(); expect(look(back, 2)).toEqual({ bg: '#b6e6ad', bold: true });
});

it('includes styled spill cells once and excludes empty cells in whole-column duplicate ranges', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 2, 3, '=SEQUENCE(3)'); wb.setInput(id, 5, 3, '2'); wb.setCells(id, [{ r: 3, c: 3, cell: { s: { bold: true } } }]);
  wb.addRule(id, { type: 'dup', range: { r1: 0, c1: 3, r2: 1048575, c2: 3 }, style: paint });
  const back = await save(wb, false);
  expect([2, 3, 4, 5, 100000].map(r => !!look(back, r))).toEqual([false, true, false, true, false]);
  back.setInput(back.activeSheetId, 5, 3, '4'); expect(look(back, 3)).toBeNull();
});
