// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart, normalizeChart } from '../src/core/charts.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}

const TABLE = { A1: 'Month', B1: 'Sales', C1: 'Costs', A2: 'Jan', B2: '100', C2: '60', A3: 'Feb', B3: '120', C3: '70', A4: 'Mar', B4: '90', C4: '65' };
const chart = (extra = {}) => ({ ...defaultChart(parseRange('A1:C4'), { r: 0, c: 4 }), ...extra });

describe('hidden lines in chart data', () => {
  it('leaves hidden rows out by default', () => {
    const { wb, id } = book(TABLE);
    wb.setHidden(id, 'row', [2], true);
    const d = chartData(wb, id, chart());
    expect(d.categories).toEqual(['Jan', 'Mar']);
    expect(d.series[0].values).toEqual([100, 90]);
  });

  it('leaves rows a filter hides out, and shows them again when the filter goes', () => {
    const { wb, id } = book(TABLE);
    wb.setFilterRange(id, parseRange('A1:C4'));
    wb.setFilterCriteria(id, 0, { values: ['Jan', 'Feb'] });
    expect(chartData(wb, id, chart()).categories).toEqual(['Jan', 'Feb']);
    wb.clearFilter(id);
    expect(chartData(wb, id, chart()).categories).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('leaves hidden columns out, dropping their series', () => {
    const { wb, id } = book(TABLE);
    wb.setHidden(id, 'col', [1], true);
    const d = chartData(wb, id, chart());
    expect(d.series.map((s) => s.name)).toEqual(['Costs']);
    expect(d.categories).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('charts hidden lines when the chart asks for them', () => {
    const { wb, id } = book(TABLE);
    wb.setHidden(id, 'row', [2], true);
    wb.setHidden(id, 'col', [1], true);
    const d = chartData(wb, id, chart({ includeHidden: true }));
    expect(d.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(d.series.map((s) => s.name)).toEqual(['Sales', 'Costs']);
    expect(normalizeChart(chart({ includeHidden: true })).includeHidden).toBe(true);
    expect(normalizeChart(chart()).includeHidden).toBe(false);
  });

  it.each([false, true])('keeps hidden pivot report data with explicit references=%s', (referenced) => {
    const { wb, id } = book(TABLE);
    const pivot = chart({ pivotSource: { name: 'Report!Summary', standalone: false } });
    if (referenced) pivot.sourceRefs = [{ nameRef: 'B1', categories: 'A2:A4', values: 'B2:B4' }];
    wb.setHidden(id, 'row', [2], true);
    wb.setHidden(id, 'col', [0, 1], true);
    wb.setFilterRange(id, parseRange('A1:C4'));
    wb.setFilterCriteria(id, 0, { values: ['Jan'] });
    const data = chartData(wb, id, pivot);
    expect(data.categories).toEqual(['Jan', 'Feb', 'Mar']);
    expect(data.series[0]).toMatchObject({ name: 'Sales', values: [100, 120, 90] });
    expect(pivot.includeHidden).toBe(false);
    // A report value change is still live, even when its worksheet cell is hidden.
    wb.setInput(id, 2, 1, '135');
    expect(chartData(wb, id, pivot).series[0].values).toEqual([100, 135, 90]);
    // An ordinary chart over the same cells must still honor worksheet visibility.
    delete pivot.pivotSource;
    const ordinary = chartData(wb, id, pivot);
    if (referenced) expect(ordinary.series[0].values).toEqual([]);
    else expect(ordinary.series.map(s => s.name)).not.toContain('Sales');
  });

  it('gives an empty chart, not an error, when every charted line is hidden', () => {
    const { wb, id } = book(TABLE);
    wb.setHidden(id, 'row', [0, 1, 2, 3], true);
    expect(chartData(wb, id, chart()).series).toEqual([]);
    const { wb: wb2, id: id2 } = book(TABLE);
    wb2.setHidden(id2, 'col', [0, 1, 2], true);
    expect(chartData(wb2, id2, chart()).series).toEqual([]);
  });
});

describe('the chart dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    closeAllModals();
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('offers to include hidden cells, previewing and saving the choice', () => {
    const { wb, id } = book(TABLE);
    wb.setHidden(id, 'row', [2], true);
    openChartDialog({ wb, sheetId: () => id, range: () => parseRange('A1:C4'), grid: { focus: vi.fn(), selectChart: vi.fn() } });
    const box = [...document.querySelectorAll('label.check')].find((node) => node.textContent === 'Include hidden cells').querySelector('input');
    expect(box.checked).toBe(false);
    expect(document.querySelector('.chart-preview').innerHTML).not.toContain('>Feb<');
    box.click();
    expect(document.querySelector('.chart-preview').innerHTML).toContain('>Feb<');
    document.querySelector('form').requestSubmit();
    expect(wb.sheet(id).charts[0].includeHidden).toBe(true);
  });
});
