import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('renames explicit table column references in floating objects on every sheet and undoes them together', () => {
  const wb = new Workbook(), data = wb.activeSheet;
  wb.setInput(data.id, 0, 0, 'Amount'); wb.setInput(data.id, 1, 0, '7');
  wb.addTable(data.id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name: 'Orders' });
  const view = wb.addSheet('View');
  const scroll = wb.addChart(view.id, { type: 'scroll', anchor: { r: 0, c: 3 }, linkRef: 'Orders[Amount]' });
  const chart = wb.addChart(view.id, { type: 'column', anchor: { r: 5, c: 3 }, range: { r1: 0, c1: 0, r2: 1, c2: 0 }, sourceRefs: [{ values: 'Orders[Amount]' }] });
  wb.setInput(data.id, 0, 0, 'Price');
  expect(wb.chartById(view.id, scroll).linkRef).toBe('Orders[Price]');
  expect(wb.chartById(view.id, chart).sourceRefs[0].values).toBe('Orders[Price]');
  wb.undo();
  expect(wb.chartById(view.id, scroll).linkRef).toBe('Orders[Amount]');
  expect(wb.chartById(view.id, chart).sourceRefs[0].values).toBe('Orders[Amount]');
  wb.redo(); expect(wb.chartById(view.id, chart).sourceRefs[0].values).toBe('Orders[Price]');
});
