// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { MOD_KEY } from '../src/ui/dom.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => document.body.replaceChildren());

// Undo and Redo were built with "Right-click for the history" in their tooltip, and the first refresh,
// which runs as the toolbar is created, replaced the whole tooltip with the step to undo: the one way
// to learn that the history exists was never shown.
it('keeps the right-click hint in the Undo and Redo tooltips whenever there is a history to show', () => {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  const undo = toolbar.el.querySelector('[aria-label="Undo"]');
  const redo = toolbar.el.querySelector('[aria-label="Redo"]');
  expect(undo.title).toBe('Nothing to undo');
  expect(redo.title).toBe('Nothing to redo');
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  toolbar.refresh();
  expect(undo.title).toBe(`Undo ${wb.undoLabel().toLowerCase()} (${MOD_KEY}+Z). Right-click for the history`);
  expect(redo.title).toBe('Nothing to redo');
  wb.undo();
  toolbar.refresh();
  expect(undo.title).toBe('Nothing to undo');
  expect(redo.title).toBe(`Redo ${wb.redoLabel().toLowerCase()} (${MOD_KEY}+Shift+Z). Right-click for the history`);
});
