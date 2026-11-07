import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('filters spilled cells by their displayed text and formatting', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Values');
  wb.setInput(id, 1, 0, '=SEQUENCE(3)');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'currency', cur: 'USD', dec: 2 });
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['$2.00'] });
  expect([...wb.activeSheet.filterHidden]).toEqual([1, 3]);
  wb.undo();
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
  wb.redo();
  expect([...wb.activeSheet.filterHidden]).toEqual([1, 3]);
  wb.setInput(id, 1, 0, '=SEQUENCE(3,1,2)');
  wb.reapplyFilter(id);
  expect([...wb.activeSheet.filterHidden]).toEqual([2, 3]);
});

it('offers and filters conditional fill colors on styled and unstyled spill cells', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 1, c1: 0, r2: 3, c2: 0 };
  wb.setInput(id, 0, 0, 'Values');
  wb.setInput(id, 1, 0, '=SEQUENCE(3)');
  wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { italic: true, bg: '#0000ff' });
  wb.addRule(id, { range, type: 'gt', value: 1, style: { bg: '#ff0000' } });
  wb.setFilterRange(id, { ...range, r1: 0 });

  expect(wb.conditionalStyle(id, 2, 0, wb.getValue(id, 2, 0))).toEqual({ bg: '#ff0000' });
  expect(wb.filterColors(id, 0)).toEqual([{ color: '#ff0000', count: 2 }, { color: '', count: 1 }]);
  expect(wb.columnFills(id, range, 0)).toEqual([{ color: '#ff0000', count: 2 }]);
  wb.setFilterCriteria(id, 0, { color: '#ff0000' });
  expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  wb.undo();
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
  wb.redo();
  expect([...wb.activeSheet.filterHidden]).toEqual([1]);
  wb.setInput(id, 1, 0, '=SEQUENCE(3,1,0)');
  wb.reapplyFilter(id);
  expect([...wb.activeSheet.filterHidden]).toEqual([1, 2]);
  expect(wb.filterColors(id, 0)).toEqual([
    { color: '#0000ff', count: 1 }, { color: '#ff0000', count: 1 }, { color: '', count: 1 },
  ]);
});
