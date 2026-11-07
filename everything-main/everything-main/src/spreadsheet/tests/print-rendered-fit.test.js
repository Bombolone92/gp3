// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, preparePrintRoot, printableWidth, printableHeight } from '../src/ui/print.js';
import { stylesheet } from './helpers/css.js';

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); vi.restoreAllMocks(); });

function layout(opts = {}) {
  const wb = new Workbook({ sheets: [{ name: 'Report', rows: 200,
    cells: { '0,0': { v: 'Heading' }, '49,9': { v: 'Last value' } },
  }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { fit: 'pages', marginBoxes: false, ...opts });
  document.body.append(root);
  const section = root.querySelector('.print-section'), sheet = root.querySelector('.print-sheet'), table = root.querySelector('table');
  return { wb, root, section, sheet, table };
}

// jsdom has no layout engine. These measurements model a renderer's complete
// frame, with a border that occupies physical layout space after scaling and
// title/footer furniture outside the scaled sheet. Native Chrome checks cover
// actual collapsed-border geometry and pagination.
function geometry(nodes, { width, height, border = 1, furniture = 0 }) {
  const rect = () => {
    const scale = Number(nodes.sheet.style.zoom) || 1;
    return new DOMRect(0, 0, width * scale + border, height * scale + border);
  };
  vi.spyOn(nodes.table, 'getBoundingClientRect').mockImplementation(rect);
  vi.spyOn(nodes.sheet, 'getBoundingClientRect').mockImplementation(rect);
  vi.spyOn(nodes.section, 'getBoundingClientRect').mockImplementation(() => {
    const r = rect(); return new DOMRect(0, 0, r.width, r.height + furniture);
  });
  return rect;
}

it.each([1, 3, 7])('fits rendered frames with %ipx of border expansion and unscaled page furniture', border => {
  const opts = { horizontalCentered: true, verticalCentered: true };
  const nodes = layout(opts), before = nodes.wb.toJSON(), initial = Number(nodes.sheet.style.zoom);
  const furniture = 45, rect = geometry(nodes, { width: 1000, height: 1500, border, furniture });
  nodes.section.style.width = '73%';
  preparePrintRoot(nodes.root);
  expect(Number(nodes.sheet.style.zoom)).toBeLessThan(initial);
  expect(rect().width).toBeLessThanOrEqual(printableWidth(opts));
  expect(rect().height + furniture).toBeLessThanOrEqual(printableHeight(opts));
  const position = nodes.root.querySelector('.print-position');
  expect(parseFloat(position.style.paddingLeft)).toBeCloseTo((printableWidth(opts) - rect().width) / 2);
  expect(parseFloat(position.style.paddingTop)).toBeCloseTo((printableHeight(opts) - furniture - rect().height) / 2);
  const scale = nodes.sheet.style.zoom;
  preparePrintRoot(nodes.root);
  expect(nodes.sheet.style.zoom).toBe(scale);
  expect(nodes.section.style.width).toBe('73%');
  expect(nodes.root.classList.contains('print-measuring')).toBe(false);
  expect(nodes.wb.toJSON()).toEqual(before);
});

it('fits width without shrinking a long sheet to one page tall', () => {
  const nodes = layout({ fit: 'width' }), rect = geometry(nodes, { width: 2000, height: 10000, border: 4 });
  preparePrintRoot(nodes.root);
  expect(rect().width).toBeLessThanOrEqual(printableWidth());
  expect(rect().height).toBeGreaterThan(printableHeight());
});

it.each(['actual', 'scale'])('preserves explicitly selected %s sizing', fit => {
  const nodes = layout({ fit, scale: 175 }), scale = nodes.sheet.style.zoom;
  preparePrintRoot(nodes.root);
  expect(nodes.sheet.style.zoom).toBe(scale);
});

it('respects the minimum scale when the requested page count cannot contain the content', () => {
  const nodes = layout(); geometry(nodes, { width: 100000, height: 100000 });
  preparePrintRoot(nodes.root);
  expect(nodes.sheet.style.zoom).toBe('0.1');
  expect(nodes.root.classList.contains('print-measuring')).toBe(false);
});

it('retains estimates and centering when layout measurements are unavailable', () => {
  const nodes = layout({ horizontalCentered: true, verticalCentered: true });
  const scale = nodes.sheet.style.zoom, position = nodes.root.querySelector('.print-position'), padding = position.getAttribute('style');
  preparePrintRoot(nodes.root);
  expect(nodes.sheet.style.zoom).toBe(scale);
  expect(position.getAttribute('style')).toBe(padding);
});

it('uses print typography during hidden measurement without exposing a screen preview', () => {
  const css = document.createElement('style'); css.textContent = stylesheet('editor.css'); document.head.append(css);
  const nodes = layout();
  expect(getComputedStyle(nodes.root).display).toBe('none');
  vi.spyOn(nodes.table, 'getBoundingClientRect').mockImplementation(() => {
    expect(getComputedStyle(nodes.root).display).toBe('block');
    expect(getComputedStyle(nodes.root).visibility).toBe('hidden');
    expect(getComputedStyle(nodes.table).borderCollapse).toBe('collapse');
    return new DOMRect();
  });
  preparePrintRoot(nodes.root);
  expect(getComputedStyle(nodes.root).display).toBe('none');
});
