// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { closeMenu } from '../src/ui/menu.js';

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

let tabs;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { closeMenu(); tabs?.destroy(); document.body.replaceChildren(); });

// Every edit records an undo step, and the strip rebuilt all its tabs (and scrolled the active one
// into view) on that "history" change too, so typing into a 50-sheet workbook rebuilt 50 tabs per
// keystroke. Everything that changes a tab already announces itself as a structure or active-sheet change.
it('leaves the tabs alone while cells are edited, and still rebuilds them for every change to a sheet', () => {
  const wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }] });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  const id = wb.activeSheetId;
  const strip = tabs.el.querySelector('.tab-strip');
  const rebuilt = vi.spyOn(strip, 'replaceChildren');
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled; // the build at creation has already scrolled once
  for (let i = 0; i < 20; i++) wb.setInput(id, i, 0, String(i));
  wb.undo();
  wb.redo();
  expect(rebuilt).not.toHaveBeenCalled();
  expect(scrolled).not.toHaveBeenCalled();

  const names = () => [...strip.querySelectorAll('.tab-name')].map((n) => n.textContent);
  wb.renameSheet(id, 'Renamed');
  expect(names()).toEqual(['Renamed', 'Second']);
  wb.undo();
  expect(names()).toEqual(['First', 'Second']);
  wb.setSheetColor(id, '#c22a2a');
  expect(strip.querySelector('.tab.colored')).toBeTruthy();
  wb.setSheetProtected(id, true);
  expect(strip.querySelector('.tab-lock')).toBeTruthy();
  wb.setActiveSheet(wb.sheets[1].id);
  expect(strip.querySelector('.tab.active .tab-name').textContent).toBe('Second');
  wb.addSheet('Third');
  expect(names()).toEqual(['First', 'Second', 'Third']);
  wb.setSheetHidden(wb.sheets[1].id, true);
  expect(names()).toEqual(['First', 'Third']);
  wb.moveSheet(wb.sheets[0].id, 2);
  expect(names()).toEqual(['Third', 'First']);
  wb.deleteSheet(wb.visibleSheets[0].id);
  expect(names()).toEqual(['First']);
});
