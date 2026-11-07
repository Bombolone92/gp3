// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { createStatusBar } from '../src/ui/statusbar.js';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/puter.js';
import { closeMenu } from '../src/ui/menu.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: false })); document.body.replaceChildren(); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A button that shows a value (the font, the size, the zoom, the sort order) was named only by its
// role, so a screen reader heard "Font" without the font, and voice control could not target the
// text it saw. The spoken name now includes the visible value.
it('names the font and size buttons with the value they show', () => {
  const wb = new Workbook();
  const style = { font: 'serif', size: 24 }; // 24px, shown in points
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.refresh();
  const font = toolbar.el.querySelector('.tb-font');
  const size = toolbar.el.querySelector('.tb-size');
  expect(font.getAttribute('aria-label')).toBe(`Font: ${font.querySelector('.tb-font-label').textContent}`);
  expect(font.getAttribute('aria-label')).not.toBe('Font: ');
  expect(size.getAttribute('aria-label')).toBe('Font size: 18');
});

it('names the zoom button with the current zoom', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  const bar = createStatusBar({ wb, sheetId: () => id, activeCell: () => wb.getCell(id, 0, 0), subscribe: () => () => {}, grid: { range, selection: { ...S.fromRange(range), active: { r: 0, c: 0 } }, zoom: 1.25 } });
  document.body.append(bar.el);
  bar.refresh();
  const zoom = bar.el.querySelector('.zoom-label');
  expect(zoom.textContent).toBe('125%');
  expect(zoom.getAttribute('aria-label')).toBe('Zoom level: 125%');
});

it('names the sort button with the order it shows', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  const view = homeView({});
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(0);
  const sort = view.el.querySelector('.home-sort');
  expect(sort.getAttribute('aria-label')).toBe(`Sort spreadsheets by: ${sort.textContent.trim()}`);
  expect(sort.textContent.trim()).not.toBe('');
  view.destroy?.();
});
