// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { pivotDateSerial, serialParts, periodBounds, timelinePeriods, timelineSelectionLabel, pivotDateFields,
  insertTimeline, setTimelineSelection, timelineState, deleteTimeline, normalizeTimeline } from '../src/core/timeline.js';
import { createTimelineControl } from '../src/ui/timeline.js';
import { pivotBook } from './helpers/native-pivot-report-fixture.js';
import { insertPivotSlicers } from '../src/core/slicer-insert.js';
import { slicerItems, setSlicerSelection } from '../src/core/slicer.js';

const serial = iso => pivotDateSerial(`${iso}T00:00:00`);

it('turns PivotCache dates into date serials and back into calendar parts', () => {
  expect(serial('2024-01-01')).toBe(45292);
  expect(serial('1900-01-01')).toBe(1);
  expect(serial('1900-03-01')).toBe(61);
  expect(pivotDateSerial('2024-01-01T12:00:00')).toBe(45292.5);
  expect(pivotDateSerial('nonsense')).toBeNull();
  expect(serialParts(45383)).toEqual({ y: 2024, m: 3, d: 1 });
});

it('lays out periods at every level with their groups and captions the selected range', () => {
  expect(periodBounds(serial('2024-05-17'), 'quarters')).toEqual({ start: serial('2024-04-01'), end: serial('2024-06-30') });
  expect(periodBounds(serial('2024-12-17'), 'months')).toEqual({ start: serial('2024-12-01'), end: serial('2024-12-31') });
  expect(periodBounds(serial('2024-12-17'), 'years')).toEqual({ start: serial('2024-01-01'), end: serial('2024-12-31') });
  const months = timelinePeriods(serial('2024-11-20'), serial('2025-02-03'), 'months');
  expect(months.map(p => `${p.group} ${p.label}`)).toEqual(['2024 NOV', '2024 DEC', '2025 JAN', '2025 FEB']);
  expect(timelinePeriods(serial('2024-02-27'), serial('2024-03-01'), 'days').map(p => p.label)).toEqual(['27', '28', '29', '1']);
  expect(timelinePeriods(serial('2023-06-01'), serial('2024-01-01'), 'quarters').map(p => p.label)).toEqual(['Q2', 'Q3', 'Q4', 'Q1']);
  expect(timelineSelectionLabel(null, null, 'months')).toBe('All Periods');
  expect(timelineSelectionLabel(serial('2024-01-01'), serial('2024-03-31'), 'months')).toBe('Jan - Mar 2024');
  expect(timelineSelectionLabel(serial('2024-03-01'), serial('2024-03-31'), 'months')).toBe('Mar 2024');
  expect(timelineSelectionLabel(serial('2024-01-01'), serial('2025-12-31'), 'years')).toBe('2024 - 2025');
});

it('offers only date fields, and filters the PivotTable to the chosen range', () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  expect(pivotDateFields(wb, pivot)).toEqual([{ index: 2, name: 'When' }]);
  const id = insertTimeline(wb, report.id, pivot, 2);
  const control = wb.chartById(report.id, id);
  expect(control).toMatchObject({ type: 'timeline', field: 'When', level: 'months', start: null, report: { owner: report.id, name: 'PivotTable1' } });
  const state = timelineState(wb, control);
  expect([state.min, state.max]).toEqual([serial('2024-01-01'), serial('2025-01-01')]);
  // All of 2024: the 2025 East row drops out.
  expect(setTimelineSelection(wb, report.id, id, serial('2024-01-01'), serial('2024-12-31'))).toBe(true);
  expect([wb.getValue(report.id, 3, 1), wb.getValue(report.id, 4, 1)]).toEqual([4, 9]);
  expect(wb.chartById(report.id, id)).toMatchObject({ start: serial('2024-01-01'), end: serial('2024-12-31') });
  // January 2025 alone: only East remains.
  setTimelineSelection(wb, report.id, id, serial('2025-01-01'), serial('2025-01-31'));
  expect(wb.getValue(report.id, 3, 0)).toBe('East');
  expect(wb.getValue(report.id, 3, 1)).toBe(2);
  // Undo steps back one filter at a time, control and report together.
  wb.undo();
  expect(wb.chartById(report.id, id).start).toBe(serial('2024-01-01'));
  expect(wb.getValue(report.id, 4, 1)).toBe(9);
  // Clear shows everything again.
  setTimelineSelection(wb, report.id, id, null, null);
  expect(wb.getValue(report.id, 3, 1)).toBe(6);
});

it('takes its filter off the PivotTable when deleted', () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  const id = insertTimeline(wb, report.id, pivot, 2);
  setTimelineSelection(wb, report.id, id, serial('2025-01-01'), serial('2025-01-31'));
  expect(deleteTimeline(wb, report.id, id)).toBe(true);
  expect(wb.sheet(report.id).charts).toHaveLength(0);
  expect(wb.getValue(report.id, 3, 1)).toBe(6);
});

it('keeps the timeline and the filtered PivotTable through an .xlsx round trip', async () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  const id = insertTimeline(wb, report.id, pivot, 2);
  setTimelineSelection(wb, report.id, id, serial('2024-01-01'), serial('2024-12-31'));
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  // The filter is the date field's member selection in the PivotTable part, which Excel reads.
  const definition = new TextDecoder().decode(X.CFB.find(zip, '/xl/pivotTables/pivotTable1.xml').content);
  expect(definition).toMatch(/<pivotField showAll="0"><items count="4"><item x="0"\/><item x="1"\/><item x="2" h="1"\/><item t="default"\/><\/items><\/pivotField>/);
  const back = await workbookFromFile(new Uint8Array(bytes), 'timeline.xlsx');
  const sheet = back.sheets.find(s => s.name === 'Report');
  const control = sheet.charts.find(c => c.type === 'timeline');
  expect(control).toMatchObject({ field: 'When', start: serial('2024-01-01'), end: serial('2024-12-31') });
  expect(timelineState(back, control).max).toBe(serial('2025-01-01'));
});

it('draws periods, selects by click and Shift-click, and changes level', () => {
  const calls = [];
  const view = createTimelineControl(document, (start, end, level, levelOnly) => { calls.push([start, end, level, !!levelOnly]); return true; });
  document.body.append(view.node);
  const control = normalizeTimeline({ id: 't', anchor: { r: 0, c: 0 }, report: { owner: 's', name: 'P' }, field: 'When', title: 'When' });
  view.update(control, { min: serial('2024-01-15'), max: serial('2024-04-02'), start: null, end: null, days: new Set([serial('2024-01-15')]) });
  const tiles = [...view.node.querySelectorAll('.timeline-tile')];
  expect(tiles.map(t => t.textContent)).toEqual(['JAN', 'FEB', 'MAR', 'APR']);
  expect(view.node.querySelector('.timeline-label').textContent).toBe('All Periods');
  const press = (tile, extra = {}) => {
    tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...extra }));
    tile.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...extra }));
  };
  press(tiles[1]);
  expect(calls.at(-1)).toEqual([serial('2024-02-01'), serial('2024-02-29'), 'months', false]);
  tiles[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
  expect(calls.at(-1)).toEqual([serial('2024-02-01'), serial('2024-04-30'), 'months', false]);
  view.update(control, { min: serial('2024-01-15'), max: serial('2024-04-02'), start: serial('2024-02-01'), end: serial('2024-04-30'), days: new Set() });
  expect(view.node.querySelector('.timeline-label').textContent).toBe('Feb - Apr 2024');
  expect([...view.node.querySelectorAll('.timeline-tile')].map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'true', 'true']);
  const level = view.node.querySelector('select');
  level.value = 'quarters'; level.dispatchEvent(new Event('change'));
  expect(calls.at(-1)).toEqual([serial('2024-02-01'), serial('2024-04-30'), 'quarters', true]);
  view.node.querySelector('.timeline-clear').click();
  expect(calls.at(-1).slice(0, 2)).toEqual([null, null]);
  view.node.remove();
});

it('works beside slicers on the same PivotTable, each dimming what the other leaves without data', () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  const [regions, amounts] = insertPivotSlicers(wb, report.id, pivot, [0, 1]);
  const id = insertTimeline(wb, report.id, wb.nativePivots.tables[0], 2);
  // January 2025 holds one East row of 2.
  setTimelineSelection(wb, report.id, id, serial('2025-01-01'), serial('2025-01-31'));
  const available = sid => slicerItems(wb, wb.chartById(report.id, sid)).map(i => [i.value, i.available]);
  expect(available(regions)).toEqual([['East', true], ['West', false]]);
  expect(available(amounts)).toEqual([['2', true], ['4', false], ['9', false]]);
  // A slicer choice then narrows the other slicer too.
  setTimelineSelection(wb, report.id, id, null, null);
  expect(setSlicerSelection(wb, report.id, regions, [1])).toBe(true);
  expect(available(amounts)).toEqual([['2', false], ['4', false], ['9', true]]);
  expect(wb.getValue(report.id, 3, 0)).toBe('West');
});

it('keeps a duplicated timeline showing the same filter', () => {
  const { wb, report, pivot } = pivotBook({ dateField: true });
  const id = insertTimeline(wb, report.id, pivot, 2);
  const copy = wb.duplicateChart(report.id, id);
  setTimelineSelection(wb, report.id, copy, serial('2024-01-01'), serial('2024-03-31'));
  expect([id, copy].map(x => wb.chartById(report.id, x).end)).toEqual([serial('2024-03-31'), serial('2024-03-31')]);
});
