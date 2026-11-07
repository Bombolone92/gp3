// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { createStatusBar } from '../src/ui/statusbar.js';

afterEach(() => document.body.replaceChildren());

it.each([false, true])('explains a selected spilled error and clears stale help after recalculation (styled: %s)', (styled) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '={1;#DIV/0!}');
  if (styled) wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
  const grid = { range: { r1: 1, c1: 0, r2: 1, c2: 0 }, selection: S.single(1, 0), zoom: 1 };
  const bar = createStatusBar({ wb, grid, sheetId: () => id, activeCell: () => wb.getCell(id, 1, 0), subscribe: () => () => {} });
  document.body.append(bar.el);
  expect(wb.getValue(id, 1, 0)).toEqual({ error: '#DIV/0!' });
  const error = bar.el.querySelector('.status-error');
  expect(error?.textContent).toContain('Division by zero');
  expect(error?.title).toBe(wb.errorHelpAt(id, 1, 0));
  wb.setInput(id, 0, 0, '=SEQUENCE(2)');
  bar.refresh();
  expect(bar.el.querySelector('.status-error')).toBeNull();
  wb.undo();
  bar.refresh();
  expect(bar.el.querySelector('.status-error')?.textContent).toContain('Division by zero');
  bar.destroy();
});
