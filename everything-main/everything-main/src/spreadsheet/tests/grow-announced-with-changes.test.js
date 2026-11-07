import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Growing a sheet by scrolling (ensureSize) announced its layout change directly, outside the change
// path: inside a transaction the grid heard it at once, before the cells it was growing for, and the
// version did not move with the layout. Growth is still no edit: nothing is recalculated and the
// document is no dirtier for a scroll.
describe('growing a sheet by scrolling', () => {
  const listen = (wb) => {
    const events = [];
    wb.addEventListener('change', (e) => events.push(e.detail.type));
    return events;
  };

  it('is announced once, with the transaction it happens in, after the transaction ends', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const events = listen(wb);
    let during = null;
    wb.transaction('Grow and write', () => {
      wb.ensureSize(id, 300, 26);
      during = events.slice();
      wb.setInput(id, 250, 0, 'far');
    });
    expect(during).toEqual([]);
    expect(events.filter((t) => t === 'layout')).toHaveLength(1);
    expect(events.indexOf('layout')).toBeLessThan(events.indexOf('history'));
    expect(wb.sheet(id).rows).toBe(300);
  });

  it('moves the version on without dirtying the document, recording a step, or dropping calculated values', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=1+1');
    expect(wb.getValue(id, 0, 0)).toBe(2);
    wb.markClean();
    const events = listen(wb);
    const { version } = wb;
    const steps = wb.undoLabels().length;
    expect(wb.ensureSize(id, 200, 26)).toBe(true);
    expect(events).toEqual(['layout']);
    expect(wb.version).toBeGreaterThan(version);
    expect(wb.dirty).toBe(false);
    expect(wb.undoLabels().length).toBe(steps);
    expect(wb._cache.size).toBeGreaterThan(0); // the calculated values are kept: no value depends on the size
    expect(wb.ensureSize(id, 200, 26)).toBe(false); // nothing to grow announces nothing
    expect(events).toEqual(['layout']);
  });
});
