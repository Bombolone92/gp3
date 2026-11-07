// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

// The grid root takes the app's theme; a var(--surface) declared there resolves to the dark surface,
// and spilling or merged cells on the light sheet came out black in dark mode.
it('leaves the default cell fill unset without a workbook default, so cells resolve --surface on the sheet', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'a label long enough to spill over the cells to its right');
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el);
  try {
    await flush();
    expect(grid.el.querySelector('#gc-0-0').classList.contains('spill')).toBe(true);
    expect(grid.el.style.getPropertyValue('--cell-default-bg')).toBe('');
  } finally { grid.destroy(); }
});

it('still carries a workbook default fill to spilling and merged cells', async () => {
  const wb = new Workbook();
  wb.nativeDefaultCellFormat = { style: { bg: '#ffeecc' } }; // the projection an imported cell XF zero with a fill gives
  const grid = createGrid({ wb, sheetId: wb.activeSheetId }); document.body.append(grid.el);
  try {
    await flush();
    expect(grid.el.style.getPropertyValue('--cell-default-bg')).not.toBe('');
    expect(grid.el.style.getPropertyValue('--cell-default-bg')).not.toContain('var(');
  } finally { grid.destroy(); }
});
