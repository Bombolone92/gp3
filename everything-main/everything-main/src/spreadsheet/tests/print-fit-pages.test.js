// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fitPrintPageScale, quantizePrintScale } from '../src/ui/print-pagination.js';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, preparePrintRoot } from '../src/ui/print.js';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('fits whole columns instead of dividing total width by the page count', () => {
  expect(fitPrintPageScale([{ sizes: [400, 400, 400], capacity: 650, pages: 2 }], 1)).toBe(.81);
  expect(fitPrintPageScale([{ sizes: [90, 570, 570, 60], capacity: 700, pages: 2 }], 1)).toBe(1);
});

it('accounts for every repeated heading and never clips a line to satisfy a fit count', () => {
  expect(fitPrintPageScale([{ sizes: [100, 100, 300, 300, 300], capacity: 700, pages: 2, repeat: 2 }], 1)).toBe(.87);
  expect(fitPrintPageScale([{ sizes: [900, 50], capacity: 600, pages: 2 }], 1)).toBe(.66);
  expect(fitPrintPageScale([{ sizes: [400, 400, 100], capacity: 600, pages: 2, repeat: 2 }], 1)).toBe(.66);
});

it('satisfies both dimensions and honors the unbounded value zero', () => {
  const axes = [{ sizes: [400, 400, 400], capacity: 650, pages: 2 }, { sizes: [300, 300, 300], capacity: 450, pages: 2 }];
  expect(fitPrintPageScale(axes, 1)).toBe(.75);
  expect(fitPrintPageScale([{ ...axes[0], pages: 0 }, axes[1]], 1)).toBe(.75);
  expect(fitPrintPageScale(axes.map(a => ({ ...a, pages: 0 })), 1)).toBe(1);
});

it('preserves already fitted scales, title-only tables and the minimum scale', () => {
  expect(fitPrintPageScale([{ sizes: [160, 160, 160], capacity: 650, pages: 2 }], .4)).toBe(.4);
  expect(fitPrintPageScale([{ sizes: [60, 70], capacity: 130, pages: 1, repeat: 2 }], .4)).toBe(.4);
  expect(fitPrintPageScale([{ sizes: [100000], capacity: 100, pages: 1 }], 1)).toBe(.1);
  expect(fitPrintPageScale([], 1)).toBe(1);
});

it('refines scale from rendered whole-column geometry and remeasures snapped borders', () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', colWidths: { 0: 450, 1: 450, 2: 450 }, cells: { '0,0': { v: 'First' }, '0,2': { v: 'Last' } } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { fit: 'pages', fitWidth: 2, fitHeight: 0, title: false, marginBoxes: true,
    paper: 'letter', margins: 'custom', customMargins: { left: .5, right: .5, top: .5, bottom: .5 } });
  document.body.append(root);
  const sheet = root.querySelector('.print-sheet'), section = root.querySelector('.print-section'), table = root.querySelector('table');
  const zoom = () => Number(sheet.style.zoom) || 1;
  for (const node of [sheet, section, table]) vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 1350 * zoom() + 1, 40 * zoom() + 1));
  [...table.querySelectorAll('col')].forEach((node, i) => vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => new DOMRect(.5 + 450 * i * zoom(), .5, 450 * zoom(), 40 * zoom())));
  vi.spyOn(table.rows[0], 'getBoundingClientRect').mockImplementation(() => new DOMRect(.5, .5, 1350 * zoom(), 40 * zoom()));
  [...table.rows[0].cells].forEach((node, i) => vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => new DOMRect(.5 + 450 * i * zoom(), .5, 450 * zoom(), 40 * zoom())));
  const before = wb.toJSON();
  preparePrintRoot(root);
  expect(Number(sheet.style.zoom)).toBe(.79);
  expect(root.querySelectorAll('.print-section')).toHaveLength(2);
  expect(wb.toJSON()).toEqual(before);
});

it('agrees with exhaustive whole-line partitions across varied capacities and repeated prefixes', () => {
  const sizes = [37,203,59,311,47,97];
  for (const repeat of [0,2,4]) for (const pages of [1,2,3]) for (const capacity of [200,501,733]) for (const scale of [1,.65]) {
    const header = sizes.slice(0, repeat).reduce((a,b) => a+b, 0), body = sizes.slice(repeat);
    let required = Infinity;
    // Independent oracle: enumerate all possible cut positions, retaining
    // partitions with no more than the requested number of pages.
    for (let cuts = 0; cuts < 2 ** (body.length - 1); cuts++) {
      const groups = [0];
      body.forEach((n,i) => { groups[groups.length-1] += n; if (i < body.length-1 && cuts & 2 ** i) groups.push(0); });
      if (groups.length <= pages) required = Math.min(required, header + Math.max(...groups));
    }
    const ideal = Math.min(scale, capacity * scale / required);
    const expected = ideal === scale ? scale : Math.max(.1, Math.floor(ideal * 100) / 100);
    expect(fitPrintPageScale([{sizes,capacity,pages,repeat}], scale)).toBe(expected);
  }
});

it('retains every supported whole percentage through floating-point arithmetic', () => {
  for (let percent = 10; percent <= 100; percent++) {
    const scale = percent / 100;
    expect(quantizePrintScale(scale)).toBe(scale);
    expect(quantizePrintScale(scale * 1)).toBe(scale);
    expect(fitPrintPageScale([{ sizes: [50], capacity: 100, pages: 1 }], scale)).toBe(scale);
    if (percent > 10) expect(quantizePrintScale(scale - 1e-8)).toBe((percent - 1) / 100);
  }
  expect(quantizePrintScale(.099)).toBe(.1);
  expect(fitPrintPageScale([{ sizes: [50], capacity: 100, pages: 1 }], .875)).toBe(.87);
});

it('keeps decimal line boundaries consistent with title-aware pagination', () => {
  const cases = [
    { sizes: [10.1, 16.1], capacity: 26.2, pages: 1 },
    { sizes: [10.1, 16.1, 10.1, 16.1], capacity: 26.2, pages: 2 },
    { sizes: [10.1, 16.1, 16.1], capacity: 26.2, pages: 2, repeat: 1 },
    { sizes: [10.1, 16.1], capacity: 26.2, pages: 1, repeat: 2 },
  ];
  for (const axis of cases) for (const scale of [1, .57, .29]) {
    const measured = { ...axis, sizes: axis.sizes.map(n => n * scale), capacity: axis.capacity * scale };
    expect(fitPrintPageScale([measured], scale)).toBe(scale);
    expect(fitPrintPageScale([{ ...measured, titles: { repeat: axis.repeat ? [0, axis.repeat] : null } }], scale)).toBe(scale);
  }
});

it('still shrinks genuine decimal overruns, including repeated titles', () => {
  for (const repeat of [0, 1, 2]) {
    const axis = { sizes: [10.1, 16.100000001], capacity: 26.2, pages: 1, repeat };
    expect(fitPrintPageScale([axis], 1)).toBe(.99);
  }
});

it.each([[1123, .85], [1537, .62]])('matches native height-fit percentage for a %spx worksheet', (height, scale) => {
  // Independent native controls, with four fixed-height rows and 20pt text,
  // print at 85% / 62% (17pt / 12.4pt glyphs) on Letter with half-inch margins.
  const wb = new Workbook({ sheets: [{ rowHeights: { 0: height / 4, 1: height / 4, 2: height / 4, 3: height / 4 },
    rowHeightModes: { 0: 'fixed', 1: 'fixed', 2: 'fixed', 3: 'fixed' },
    cells: Object.fromEntries([0,1,2,3].map(r => [`${r},0`, { v: 'Height fit', s: { size: 80 / 3 } }])) }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Height', { fit: 'pages', fitWidth: 0, fitHeight: 1, title: false,
    paper: 'letter', margins: 'custom', customMargins: { left: .5, right: .5, top: .5, bottom: .5 } });
  expect(Number(root.querySelector('.print-sheet').style.zoom)).toBe(scale);
});
