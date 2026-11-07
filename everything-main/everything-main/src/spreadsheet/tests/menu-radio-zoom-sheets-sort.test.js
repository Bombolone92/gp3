// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStatusBar } from '../src/ui/statusbar.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { homeView } from '../src/views/home.js';
import { closeMenu } from '../src/ui/menu.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// The zoom levels, the All sheets list and the home screen's Sort by were still checkbox items after the
// other one-of-many menus became radio items, so a screen reader called 150% or a sheet a checkbox.
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const roles = () => [...document.querySelectorAll('.menu-item')].map((b) => [b.querySelector('.menu-label').textContent, b.getAttribute('role'), b.getAttribute('aria-checked')]);
const checkedRadios = () => document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]').length;

it('lists the zoom levels as radio items with the current one checked, and Reset as a plain item', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const bar = createStatusBar({ wb, sheetId: () => id, activeCell: () => null, subscribe: () => () => {}, run() {}, grid: { range, selection: { ...S.fromRange(range), active: { r: 0, c: 0 } }, zoom: 1.5, focus() {} } });
  document.body.append(bar.el);
  bar.el.querySelector('.zoom-label').click();
  const items = roles();
  expect(items.filter(([, role]) => role === 'menuitemradio')).toHaveLength(11);
  expect(items.find(([label]) => label === '10%')[1]).toBe('menuitemradio');
  expect(items.find(([label]) => label === '400%')[1]).toBe('menuitemradio');
  expect(items.find(([label]) => label === 'Custom zoom…')[1]).toBe('menuitem');
  expect(items.find(([label]) => label === '150%')).toEqual(['150%', 'menuitemradio', 'true']);
  expect(items.find(([label]) => label === 'Reset to 100%')[1]).toBe('menuitem');
  expect(checkedRadios()).toBe(1);
  expect(document.activeElement.textContent).toBe('150%');
});

it.each([false, true])('represents and focuses custom zoom or chart fit (fit: %s)', (fit) => {
  const wb = new Workbook({ sheets: [{ kind: fit ? 'chart' : 'worksheet', zoomToFit: fit }] });
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const run = vi.fn();
  const bar = createStatusBar({ wb, sheetId: () => wb.activeSheetId, activeCell: () => null, subscribe: () => () => {}, run, grid: { range, selection: S.fromRange(range), zoom: 1.33, focus() {} } });
  document.body.append(bar.el);
  bar.el.querySelector('.zoom-label').click();
  expect(checkedRadios()).toBe(1);
  expect(document.activeElement.textContent).toBe(fit ? 'Fit chart to window' : '133%');
  expect(run).not.toHaveBeenCalled();
  document.activeElement.click();
  expect(run).toHaveBeenCalledWith(...(fit ? ['zoomFit'] : ['zoomTo', 1.33]));
  bar.destroy();
});

it('lists the sheets as radio items with the active one checked, and a hidden sheet as a plain item', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Notes' }, { name: 'Old' }] });
  wb.setSheetHidden(wb.sheets[2].id, true);
  wb.setActiveSheet(wb.sheets[1].id);
  const tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  tabs.el.querySelector('.tab-all').click();
  const items = roles();
  expect(items.find(([label]) => label === 'Data')).toEqual(['Data', 'menuitemradio', 'false']);
  expect(items.find(([label]) => label === 'Notes')).toEqual(['Notes', 'menuitemradio', 'true']);
  expect(items.find(([label]) => label === 'Old')[1]).toBe('menuitem');
  expect(checkedRadios()).toBe(1);
  tabs.destroy();
});

it('lists the sort orders as radio items with the current one checked', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  const view = homeView({ openPath() {}, newDoc() {}, sampleDoc() {}, templateDoc() {}, importFile() {} });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  view.el.querySelector('.home-sort').click();
  const items = roles();
  expect(items.map(([, role]) => role)).toEqual(['menuitemradio', 'menuitemradio', 'menuitemradio']);
  expect(items.find(([label]) => label === 'Last modified')[2]).toBe('true');
  expect(checkedRadios()).toBe(1);
  view.destroy?.();
});
