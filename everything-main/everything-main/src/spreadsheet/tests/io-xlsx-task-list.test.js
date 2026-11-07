import { expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { taskListXlsx } from './helpers/xlsx-task-list-fixture.js';

it('keeps task summaries live across disjoint chart sources, edits, and save/reopen', async () => {
  let wb = await workbookFromFile(taskListXlsx(), 'tasks.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.sheets[0], [daily, weekly, artwork] = s.charts;
    expect(wb.colWidth(s.id, 1)).toBe(111);
    expect(wb.colWidth(s.id, 2)).toBe(216);
    expect(wb.styleAt(s.id, 0, 0)).toMatchObject({ font: 'nyala', size: 96 });
    expect(wb.styleAt(s.id, 5, 2)).toMatchObject({ font: 'source-sans', size: 44 / 3 });
    expect(daily.w).toBe(304);
    expect(chartData(wb, s.id, daily).series[0].values).toEqual([2, 3]);
    const data = chartData(wb, s.id, weekly);
    expect(data.categories).toEqual(['Next Week', 'This Week']);
    expect(data.series[0].values).toEqual([1, 5]);
    const svg = renderChartSvg(data, weekly, weekly.w, weekly.h);
    expect(svg.match(/class="chart-series chart-bar"/g)).toHaveLength(2);
    // Random clipping IDs can contain digits from the excluded source value.
    // Only rendered labels/tooltips should be tested for leaked source text.
    const rendered = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent;
    expect(rendered).not.toMatch(/Excluded|999/);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(wb.conditionalStyle(s.id, 4, 8, wb.getValue(s.id, 4, 8))).toMatchObject({ bar: .1 + .8 / 3, barOnly: true });
    expect(wb.conditionalStyle(s.id, 1, 13, 'Next Week')).toMatchObject({ color: '#ffffff' });
    expect(wb.conditionalStyle(s.id, 4, 13, 'Tomorrow')).toMatchObject({ color: '#ffffff' });
    expect(wb.conditionalStyle(s.id, 12, 13, ' ')).toBeNull();
    expect(artwork).toMatchObject({ type: 'image', rotation: 20, border: false });
    expect(artwork.w).toBeGreaterThan(304); // rotated children extend beyond the anchor box
    expect(artwork.dx + artwork.w / 2).toBeCloseTo(152); // padding preserves the rotation center
    const vector = Buffer.from(artwork.src.split(',')[1], 'base64').toString();
    expect(vector).toContain('rotate(30)');
    expect(vector).toContain('rotate(90) scale(-1 1)');
    expect(vector).toContain('fill="#123456"');
    expect(vector).not.toMatch(/xdr:|a:|NaN|Infinity/);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const s = wb.sheets[0], weekly = s.charts[1];
  wb.setInput(s.id, 10, 3, '=TODAY()');
  expect(chartData(wb, s.id, weekly).series[0].values).toEqual([0, 6]);
  wb.undo();
  expect(chartData(wb, s.id, weekly).series[0].values).toEqual([1, 5]);
  wb.setInput(s.id, 6, 5, 'Completed');
  expect(wb.conditionalStyle(s.id, 4, 8, wb.getValue(s.id, 4, 8)).bar).toBeCloseTo(.1 + .8 * 2 / 3);
  wb.renameSheet(s.id, 'Renamed tasks');
  wb.insertRows(s.id, 0, 2);
  expect(wb.sheets[0].charts[1].sourceRefs[0].values).toContain("'Renamed tasks'!$O$4");
  expect(chartData(wb, s.id, wb.sheets[0].charts[1]).series[0].values).toEqual([1, 5]);
});

it('reads disjoint ranges in order, preserves blanks and respects hidden source rows', async () => {
  const wb = await workbookFromFile(taskListXlsx(), 'tasks.xlsx'), s = wb.sheets[0], chart = s.charts[1];
  s.hiddenRows.add(1);
  expect(chartData(wb, s.id, chart).categories).toEqual(['This Week']);
  expect(chartData(wb, s.id, { ...chart, includeHidden: true }).series[0].values).toEqual([1, 5]);
  const sources = { ...chart, includeHidden: true, sourceRefs: [{ categories: '(N5:N7,N2)', values: '(O5:O7,O2)' }] };
  expect(chartData(wb, s.id, sources).series[0].values).toEqual([2, 3, null, 1]);
  sources.sourceRefs[0].values = '(O1:O1048576,O2)';
  sources.sourceRefs[0].categories = '';
  expect(chartData(wb, s.id, sources).series[0].values.length).toBeLessThanOrEqual(5000);
});

it('omits unsupported vector geometry and retains explicit data-bar values', async () => {
  const wb = await workbookFromFile(taskListXlsx({ malformedShape: true, showValue: true }), 'tasks.xlsx'), s = wb.sheets[0];
  expect(s.charts.map(c => c.type)).toEqual(['bar', 'bar']);
  expect(wb.conditionalStyle(s.id, 4, 8, wb.getValue(s.id, 4, 8))).not.toHaveProperty('barOnly');
});
