// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1200; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 700; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });
const flush = () => new Promise((r) => setTimeout(r, 5));
/** Long enough for the deferred reading of a range that holds a formula (CHART_READ_DELAY is 150ms). */
const idle = () => new Promise((r) => setTimeout(r, 400));

// Every workbook version made each chart on the shown sheet read its whole range again, to see whether its picture
// was stale: on a dashboard of forty charts over 19,000 rows the frame after a keystroke in a cell no chart read
// went from some 17 ms to 150–230 ms. The workbook now records, version by version, the box of cells a write
// covered, and a chart reads its range again only after a change that could have reached it.

const ROWS = 19000;
const N = 40;
const BAND = ROWS / N;

/** Ten columns of numbers over 19,000 rows and forty line charts, each over a band of 475 rows; each band's last cell is blank. */
function dashboard() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, ROWS + 100, 26);
  const entries = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < 10; c++) if (!(c === 9 && (r + 1) % BAND === 0)) entries.push({ r, c, cell: { v: (r * 7 + c) % 100, f: null } });
  wb.setCells(id, entries, 'fill');
  for (let i = 0; i < N; i++) wb.addChart(id, { type: 'line', range: { r1: i * BAND, c1: 0, r2: (i + 1) * BAND - 1, c2: 9 }, anchor: { r: 2 + i * 12, c: 12 }, w: 300, h: 200 });
  return { wb, id };
}

/** Which charts read their range: the one blank cell in each band is looked up for a spill only when its range is read. */
function watchReads(wb) {
  const bands = new Set();
  const spillAt = wb.spillAt.bind(wb);
  wb.spillAt = (sheetId, r, c) => {
    if (c === 9 && r < ROWS && (r + 1) % BAND === 0) bands.add((r + 1) / BAND - 1);
    return spillAt(sheetId, r, c);
  };
  return { bands, reset: () => bands.clear() };
}

describe('a chart among many on a large sheet', () => {
  it('reads its range again only after a change that could have reached it', async () => {
    const { wb, id } = dashboard();
    const other = wb.addSheet('Other').id;
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const boxes = [...grid.el.querySelectorAll('.chart-box')];
    expect(boxes).toHaveLength(N);
    const pictures = () => boxes.map((b) => b.querySelector('svg'));
    const drawn = pictures();
    expect(drawn.every(Boolean)).toBe(true);
    const reads = watchReads(wb);

    // A value typed where no chart reads, on this sheet or another, and a column resized on another sheet: no range is read.
    wb.setInput(id, ROWS + 2, 11, 'x');
    await flush();
    wb.setInput(other, 0, 0, 'elsewhere');
    await flush();
    wb.setColWidth(other, 0, 160);
    await flush();
    expect([...reads.bands]).toEqual([]);
    expect(pictures()).toEqual(drawn);

    // A value inside one range: that range alone is read, and that chart alone is drawn again.
    wb.setInput(id, 7 * BAND + 3, 2, '999');
    await flush();
    expect([...reads.bands]).toEqual([7]);
    const changed = pictures();
    changed.forEach((svg, i) => expect(svg === drawn[i]).toBe(i !== 7));
    // The undo of that edit covers the same cells.
    reads.reset();
    wb.undo();
    await flush();
    expect([...reads.bands]).toEqual([7]);

    // Rows inserted, or a formula written anywhere on the sheet (its result may spill into a
    // range): every range is read; the pictures, unchanged, are kept.
    const kept = pictures();
    for (const change of [() => wb.insertRows(id, ROWS + 50, 1), () => wb.setInput(id, ROWS + 3, 11, '=1+1')]) {
      reads.reset();
      change();
      await flush();
      expect(reads.bands.size).toBe(N);
    }
    expect(pictures()).toEqual(kept);
    grid.destroy();
  }, 60000);

  // Growing the sheet, which a scroll to its foot does, is announced as a layout change, and a
  // layout change on the sheet reached every chart on it: a dashboard of forty charts over 19,000
  // rows read all of them again — 400,000 cells — for a scroll that revealed only blank rows past
  // the end. Growth adds lines past the sheet's old extent and hides none, and a width, a height, a
  // freeze or a protected range changes nothing a chart reads either.
  it('leaves its range unread for a layout change that reveals nothing it reads', { timeout: 60000 }, async () => {
    const { wb, id } = dashboard();
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const boxes = [...grid.el.querySelectorAll('.chart-box')];
    const pictures = () => boxes.map((b) => b.querySelector('svg'));
    const drawn = pictures();
    const reads = watchReads(wb);

    for (const change of [
      () => wb.setColWidth(id, 20, 160),
      () => wb.setRowHeight(id, 4, 40),
      () => wb.setFrozen(id, 2, 1),
    ]) {
      reads.reset();
      change();
      await flush();
      await new Promise((r) => setTimeout(r, 250)); // nothing is put off to an idle moment either
      expect([...reads.bands]).toEqual([]);
    }
    expect(pictures()).toEqual(drawn);

    // Growing the sheet, as a scroll to its foot does, is the change this was written for: it is
    // passed over in the same way once the workbook records it in its change log (until it does,
    // changesSince cannot say what happened and every range is read afresh — either way the
    // pictures stay right). The grown sheet must not defeat the test afterwards: a chart that ends
    // inside the extent its reading was taken at is still passed over.
    wb.ensureSize(id, wb.sheet(id).rows + 400, 0);
    await flush();
    expect(pictures()).toEqual(drawn);
    reads.reset();
    wb.setColWidth(id, 21, 170);
    await flush();
    expect([...reads.bands]).toEqual([]);
    expect(pictures()).toEqual(drawn);

    // Hiding a row inside one of the ranges still reaches every chart, and redraws that one.
    reads.reset();
    wb.setHidden(id, 'row', [3 * BAND + 2], true);
    await flush();
    expect(reads.bands.size).toBe(N);
    pictures().forEach((svg, i) => expect(svg === drawn[i]).toBe(i !== 3));

    // So does a change to a chart's own definition, though it too comes as a layout change.
    const after = pictures();
    reads.reset();
    const chart = wb.sheet(id).charts[5];
    wb.updateChart(id, chart.id, { title: 'Sales' });
    await flush();
    expect(reads.bands.has(5)).toBe(true);
    expect(pictures()[5]).not.toBe(after[5]);
    grid.destroy();
  });

  // The extent is what makes growth safe to pass over: a chart reaching past the extent its last
  // reading was taken at could be shown cells the growth revealed, so it reads its range again.
  it('reads a range that reaches past the extent it was last read at', { timeout: 60000 }, async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const rows = wb.sheet(id).rows;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 1, 0, '2');
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: rows + 500, c2: 0 }, anchor: { r: 3, c: 3 }, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    let reads = 0;
    const spillAt = wb.spillAt.bind(wb);
    wb.spillAt = (sid, r, c) => { if (r === 5 && c === 0) reads++; return spillAt(sid, r, c); }; // a blank cell only the range walk asks about
    wb.setColWidth(id, 20, 160);
    await flush();
    expect(reads).toBeGreaterThan(0);
    grid.destroy();
  });

  it('is drawn again for a spill that reaches into its range from outside it, and for an input of its formulas elsewhere', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const other = wb.addSheet('Other').id;
    wb.setInput(other, 0, 0, '10');
    wb.setInput(id, 0, 2, '=Other!A1*2');
    wb.setInput(id, 1, 2, '3');
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 2, r2: 2, c2: 2 }, anchor: { r: 5, c: 5 }, w: 300, h: 200 }); // over C1:C3, one formula
    wb.addChart(id, { type: 'column', range: { r1: 4, c1: 0, r2: 7, c2: 0 }, anchor: { r: 12, c: 5 }, w: 300, h: 200 }); // over A5:A8, blank
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const [formulas, blank] = [...grid.el.querySelectorAll('.chart-box')];
    const svg = (box) => box.querySelector('svg');
    const drawnFormulas = svg(formulas);
    const drawnBlank = svg(blank);

    // The formula's input is on another sheet, outside every box on this one: the range holding a formula is read
    // anyway — off the keystroke itself, so the picture follows once the browser is idle (see readRangeLater).
    wb.setInput(other, 0, 0, '25');
    await flush();
    expect(svg(formulas)).toBe(drawnFormulas);
    await idle();
    expect(svg(formulas)).not.toBe(drawnFormulas);
    expect(svg(blank)).toBe(drawnBlank);

    // A formula typed above the blank range spills into it; cleared again, the range is blank again.
    wb.setInput(id, 0, 0, '=SEQUENCE(10)');
    await flush();
    const spilled = svg(blank);
    expect(spilled).not.toBe(drawnBlank);
    wb.setInput(id, 0, 0, '');
    await flush();
    await idle();
    expect(svg(blank)).not.toBe(spilled);
    grid.destroy();
  });

  // A range holding a formula has to be read after any change, since its inputs lie anywhere in the
  // book — but reading forty computed ranges on the keystroke itself is what made typing beside a
  // dashboard slow. The reading now waits for an idle moment and the picture waits with it.
  it('reads a computed range off the keystroke, not during it', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const N = 400;
    const CHARTS = 8;
    wb.ensureSize(id, N + 40, 26);
    const entries = [];
    for (let r = 0; r < N; r++) {
      entries.push({ r, c: 0, cell: { v: `Item ${r}`, f: null, s: null } });
      entries.push({ r, c: 1, cell: { v: r * 1.5, f: null, s: null } });
      entries.push({ r, c: 2, cell: { v: r * 3, f: `B${r + 1}*2`, s: null } }); // a computed column
    }
    wb.setCells(id, entries);
    for (let i = 0; i < CHARTS; i++) wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: N - 1, c2: 2 }, anchor: { r: 1 + i, c: 6 }, w: 200, h: 120 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const boxes = [...grid.el.querySelectorAll('.chart-box')];
    expect(boxes).toHaveLength(CHARTS);
    let computed = 0;
    const getValue = wb.getValue.bind(wb);
    wb.getValue = (...args) => { computed++; return getValue(...args); };

    wb.setInput(id, 3, 12, 'unrelated'); // a keystroke in a cell no chart reads
    await flush();
    const onKeystroke = computed;
    expect(onKeystroke).toBeLessThan(N); // not CHARTS × N: no computed range was walked
    await idle();
    expect(computed).toBeGreaterThanOrEqual(CHARTS * N); // each range read once, off the critical path

    // A value inside the ranges still redraws every chart on the spot.
    const drawn = boxes.map((b) => b.querySelector('svg'));
    wb.setInput(id, 5, 1, '99');
    await flush();
    boxes.forEach((b, i) => expect(b.querySelector('svg')).not.toBe(drawn[i]));
    grid.destroy();
  }, 60000);
});
