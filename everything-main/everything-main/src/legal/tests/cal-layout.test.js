import { describe, it, expect } from 'vitest';
import { layoutDay, eventSpan, snap, viewRange, monthGrid, stepDate, viewTitle, moveEvent, resizeEvent } from '../src/core/cal-layout.js';

const ev = (id, start, end) => ({ id, start, end, date: '2026-10-12' });

describe('eventSpan', () => {
  it('reads start and end minutes', () => {
    expect(eventSpan(ev('a', '09:00', '10:30'))).toEqual({ start: 540, end: 630 });
  });
  it('gives a missing or inverted end 30 minutes', () => {
    expect(eventSpan(ev('a', '09:00', ''))).toEqual({ start: 540, end: 570 });
    expect(eventSpan(ev('a', '09:00', '08:00'))).toEqual({ start: 540, end: 570 });
  });
});

describe('layoutDay', () => {
  it('keeps separate events in one full-width column', () => {
    const out = layoutDay([ev('a', '09:00', '10:00'), ev('b', '10:00', '11:00')]);
    expect(out.map((o) => [o.event.id, o.col, o.cols, o.span])).toEqual([
      ['a', 0, 1, 1],
      ['b', 0, 1, 1],
    ]);
  });

  it('puts overlapping events side by side', () => {
    const out = layoutDay([ev('a', '09:00', '11:00'), ev('b', '09:30', '10:30'), ev('c', '10:00', '12:00')]);
    const by = Object.fromEntries(out.map((o) => [o.event.id, o]));
    expect(by.a.cols).toBe(3);
    expect(new Set([by.a.col, by.b.col, by.c.col]).size).toBe(3);
  });

  it('reuses a column once it is free and expands into free columns', () => {
    const out = layoutDay([ev('a', '09:00', '12:00'), ev('b', '09:00', '10:00'), ev('c', '10:00', '11:00')]);
    const by = Object.fromEntries(out.map((o) => [o.event.id, o]));
    expect(by.a.cols).toBe(2);
    expect(by.b.col).toBe(by.c.col);
    expect(by.a.span).toBe(1);
  });

  it('lets an event span empty columns to its right', () => {
    // a and b overlap (2 columns); c starts after b ends but overlaps a.
    const out = layoutDay([ev('a', '09:00', '10:00'), ev('b', '09:00', '09:30'), ev('c', '09:30', '10:00')]);
    const by = Object.fromEntries(out.map((o) => [o.event.id, o]));
    expect(by.a.col).toBe(0);
    expect(by.b.col).toBe(1);
    expect(by.c.col).toBe(1);
  });
});

describe('ranges and navigation', () => {
  it('computes week and month ranges', () => {
    expect(viewRange('week', '2026-10-14', 0)).toEqual(['2026-10-11', '2026-10-17']);
    expect(viewRange('week', '2026-10-14', 1)).toEqual(['2026-10-12', '2026-10-18']);
    const grid = monthGrid('2026-10-14', 0);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-27');
    expect(grid).toContain('2026-10-31');
  });

  it('steps by view', () => {
    expect(stepDate('day', '2026-10-12', 1)).toBe('2026-10-13');
    expect(stepDate('week', '2026-10-12', -1)).toBe('2026-10-05');
    expect(stepDate('month', '2026-10-31', 1)).toBe('2026-11-01');
  });

  it('titles a week inside one month', () => {
    expect(viewTitle('week', '2026-10-12', 0)).toMatch(/to 17, 2026$/);
  });

  it('snaps to quarter hours', () => {
    expect(snap(547)).toBe(540);
    expect(snap(553)).toBe(555);
  });
});

describe('moving and resizing', () => {
  it('keeps the length when moving', () => {
    expect(moveEvent(ev('a', '09:00', '10:30'), '2026-10-13', 14 * 60)).toEqual({ date: '2026-10-13', start: '14:00', end: '15:30' });
  });
  it('clamps at the end of the day', () => {
    expect(moveEvent(ev('a', '09:00', '11:00'), '2026-10-13', 23 * 60).start).toBe('22:00');
  });
  it('keeps at least 15 minutes when resizing', () => {
    expect(resizeEvent(ev('a', '09:00', '10:00'), 500)).toEqual({ end: '09:15' });
    expect(resizeEvent(ev('a', '09:00', '10:00'), 690)).toEqual({ end: '11:30' });
  });
});
