// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => document.body.replaceChildren());

// Undo and Redo looked enabled while a cell was being edited but did nothing when clicked.
it('disables Undo and Redo while a cell is being edited', () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  const grid = { editing: false };
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  const undo = toolbar.el.querySelector('.tb-btn[data-cmd="undo"]');
  toolbar.refresh();
  expect(undo.disabled).toBe(false);
  grid.editing = true;
  toolbar.refresh();
  expect(undo.disabled).toBe(true);
  grid.editing = false;
  toolbar.refresh();
  expect(undo.disabled).toBe(false);
});

// The Merge button stayed enabled during an edit although the command does nothing then.
it('disables Merge cells while a cell is being edited', () => {
  const wb = new Workbook();
  const grid = { editing: false };
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 1, c2: 0 }), sheetId: () => wb.activeSheetId, grid, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  const merge = toolbar.el.querySelector('.tb-btn[data-cmd="merge"]');
  toolbar.refresh();
  expect(merge.disabled).toBe(false);
  grid.editing = true;
  toolbar.refresh();
  expect(merge.disabled).toBe(true);
  grid.editing = false;
  toolbar.refresh();
  expect(merge.disabled).toBe(false);
});
