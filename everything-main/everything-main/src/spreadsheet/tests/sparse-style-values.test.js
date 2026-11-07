import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { assignStyleExceptions, readStyleResets, removeStyleResets, styleResetAt, compactStyleResets } from '../src/core/style-resets.js';

const box = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const border = { br: true, brBorder: { bs: 'double', bc: '#225599' } };
const record = (range, values) => ({ range, keys: Object.keys(values), values });
const book = () => new Workbook({ normalFont: { name: 'Arial', sz: 11, bold: true }, sheets: [{ name: 'Sparse styles',
  rows: 2000, cols: 50, colStyles: { 3: { bg: '#fff0cc', br: true, bs: 'thin' } },
  styleResets: [record(box(3, 2, 1000, 6), { ...border, bold: false, color: '#336699' }),
    { range: box(5, 3), keys: ['color', 'bold'] }], cells: { '4,3': { v: 8 }, '5,3': { f: 'D5*2' } },
}] });

it('resolves overlapping concrete values and resets independently by property', () => {
  const ranges = [record(box(0, 0, 8, 8), { bg: '#123456', ...border }),
    record(box(2, 2, 6, 6), { bg: '#abcdef' }), { range: box(3, 3, 5, 5), keys: ['br', 'brBorder'] },
    record(box(4, 4), { bg: '#663399', br: true })];
  const normalized = readStyleResets(ranges);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
    let expected = null;
    for (const { range: g, keys, values } of ranges) if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) {
      expected ??= {};
      for (const key of keys) expected[key] = values?.[key] ?? null;
    }
    expect(styleResetAt(normalized, r, c)).toEqual(expected);
    expect(styleResetAt(compactStyleResets(normalized), r, c)).toEqual(expected);
  }
});

it('retains falsy concrete values, while absent values restore Normal', () => {
  const wb = book(), id = wb.activeSheetId;
  expect(wb.styleAt(id, 4, 3)).toMatchObject({ ...border, bold: false, color: '#336699', bg: '#fff0cc' });
  expect(wb.styleAt(id, 5, 3)).toMatchObject({ ...border, bold: true, color: null });
  expect(wb.activeSheet.cells.size).toBe(2);
  expect(wb.getValue(id, 5, 3)).toBe(16);
});

it('keeps constructor inputs, JSON, duplicated sheets and copied cells independent', () => {
  const range = box(1, 2, 10, 4), values = { br: true, brBorder: { ...border.brBorder } };
  const records = assignStyleExceptions([], range, values);
  range.r2 = 500; values.brBorder.bc = '#ff0000';
  expect(styleResetAt(records, 11, 2)).toBeNull();
  expect(styleResetAt(records, 2, 2).brBorder).toEqual(border.brBorder);
  const wb = new Workbook({ sheets: [{ name: 'Values', styleResets: records }] }), id = wb.activeSheetId;
  records[0].values.brBorder.bc = '#00ff00';
  const json = wb.toJSON(); json.sheets[0].styleResets[0].values.brBorder.bc = '#ffff00';
  const duplicate = wb.duplicateSheet(id); duplicate.styleResets[0].values.brBorder.bc = '#990099';
  const copied = wb.copyRange(id, box(2, 2)); copied[0][0].s.brBorder.bc = '#998877';
  expect(wb.styleAt(id, 2, 2).brBorder).toEqual(border.brBorder);
});

it('removes selected properties without retaining stale values, and respects skipped rows', () => {
  const records = readStyleResets([record(box(0, 0, 5, 5), { bg: '#abcdef', ...border })]);
  const after = removeStyleResets(records, box(1, 1, 4, 4), ['br', 'brBorder'], r => r === 2);
  expect(styleResetAt(after, 3, 3)).toEqual({ bg: '#abcdef' });
  expect(styleResetAt(after, 2, 3)).toEqual({ bg: '#abcdef', ...border });
  for (const record of after) for (const key of Object.keys(record.values || {})) expect(record.keys).toContain(key);
});

it('coalesces repeated same-value edits and preserves one-cell exceptions on huge ranges', () => {
  const all = box(0, 0, 1048575, 16383);
  let records = [];
  for (let i = 0; i < 100; i++) records = assignStyleExceptions(records, all, border);
  expect(records).toHaveLength(1);
  records = assignStyleExceptions(records, box(800000, 14000), { br: null, brBorder: null });
  expect(records).toHaveLength(5);
  expect(styleResetAt(records, 800000, 14000)).toEqual({ br: null, brBorder: null });
  expect(styleResetAt(records, 800001, 14000)).toEqual(border);
});

it('validates persisted value records without retaining foreign mutable objects', () => {
  const entries = [record(box(0, 0), { brBorder: { bs: {}, bc: '#123456' }, bold: [], size: Infinity, code: 'x'.repeat(256), bg: '#abcdef' }),
    { range: box(0, 1), keys: ['br'], values: [] }, record(box(-1, 0), border),
    record(box(1, 1), { br: true, brBorder: { bs: 'double', bc: '#225599', extra: {} } })];
  const clean = readStyleResets(entries);
  expect(styleResetAt(clean, 0, 0)).toEqual({ bg: '#abcdef' });
  expect(styleResetAt(clean, 0, 1)).toBeNull();
  expect(styleResetAt(clean, 1, 1)).toEqual(border);
  expect(styleResetAt(clean, 1, 1).brBorder).not.toBe(entries[3].values.brBorder);
});

it('preserves sparse concrete formats through structural edits, typing, copying, clearing and undo', () => {
  const wb = book(), id = wb.activeSheetId, original = wb.toJSON();
  wb.insertRows(id, 10, 3); wb.insertCols(id, 1, 2);
  expect(wb.styleAt(id, 900, 5)).toMatchObject(border);
  expect(wb.styleAt(id, 1003, 5)).toMatchObject(border);
  wb.undo(); wb.undo(); expect(wb.toJSON()).toEqual(original);
  wb.setInput(id, 900, 3, '42'); expect(wb.styleAt(id, 900, 3)).toMatchObject(border);
  wb.pasteCells(id, wb.copyRange(id, box(900, 3)), 1500, 10);
  expect(wb.styleAt(id, 1500, 10)).toMatchObject(border);
  wb.applyBorders(id, box(899, 3, 901, 3), 'none');
  expect(wb.styleAt(id, 900, 3).br).toBeFalsy(); expect(wb.styleAt(id, 900, 3).color).toBe('#336699');
  wb.undo(); expect(wb.styleAt(id, 900, 3)).toMatchObject(border);
  wb.clearRange(id, box(899, 3, 901, 3), { contents: false, styles: true });
  expect(wb.styleAt(id, 900, 3)?.br).toBeFalsy(); expect(wb.getValue(id, 900, 3)).toBe(42);
  wb.undo(); expect(wb.styleAt(id, 900, 3)).toMatchObject(border);
});

it('reads thousands of disjoint value edits without replaying and compacting every prefix', () => {
  const raw = Array.from({ length: 5000 }, (_, i) => record(box(i * 2, 3), { ...border, bold: false }));
  const normalized = readStyleResets(raw);
  expect(normalized).toHaveLength(raw.length);
  expect(styleResetAt(normalized, 8000, 3)).toEqual({ ...border, bold: false });
  expect(styleResetAt(normalized, 8001, 3)).toBeNull();
  expect(readStyleResets(normalized)).toEqual(normalized);
});
