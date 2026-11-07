import { describe, it, expect } from 'vitest';
import { ObjectStore } from '../src/core/store.js';
import { bboxOfFlat, distPointSeg, pointInPoly, polyArea, cornerPoint, simplifyPolyline, makeTransform, apply, invert, arcBBox } from '../src/core/geom.js';
import { mm, mil, formatLength, parseLength, snap } from '../src/core/units.js';

const box = (o) => ({ minX: o.x - 1, minY: o.y - 1, maxX: o.x + 1, maxY: o.y + 1 });

describe('units', () => {
  it('converts and formats lengths', () => {
    expect(mm(1)).toBe(1_000_000);
    expect(mil(100)).toBe(2_540_000);
    expect(formatLength(mm(0.25), 'mm')).toBe('0.25mm');
    expect(formatLength(mil(10), 'mil')).toBe('10mil');
    expect(formatLength(0, 'mm')).toBe('0mm');
  });

  it('parses lengths with and without units', () => {
    expect(parseLength('0.2', 'mm')).toBe(200_000);
    expect(parseLength('8mil', 'mm')).toBe(203_200);
    expect(parseLength('1 in', 'mm')).toBe(25_400_000);
    expect(parseLength('10', 'mil')).toBe(254_000);
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
  });

  it('snaps to grid', () => {
    expect(snap(1_260_000, mil(100))).toBe(0);
    expect(snap(1_280_000, mil(100))).toBe(2_540_000);
    expect(snap(123, 0)).toBe(123);
  });
});

describe('geometry', () => {
  it('measures point to segment distance', () => {
    expect(distPointSeg(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distPointSeg(-3, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('tests polygons', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
    expect(polyArea(sq)).toBe(100);
    expect(bboxOfFlat(sq)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('computes routing corners', () => {
    expect(cornerPoint(0, 0, 10, 4, '90start')).toEqual([10, 0]);
    expect(cornerPoint(0, 0, 10, 4, '90end')).toEqual([0, 4]);
    expect(cornerPoint(0, 0, 10, 4, '45start')).toEqual([4, 4]);
    expect(cornerPoint(0, 0, 10, 4, '45end')).toEqual([6, 0]);
    expect(cornerPoint(0, 0, 10, 0, '90start')).toBeNull();
  });

  it('simplifies polylines', () => {
    expect(simplifyPolyline([0, 0, 5, 0, 10, 0, 10, 10, 10, 10])).toEqual([0, 0, 10, 0, 10, 10]);
  });

  it('round-trips transforms exactly for quarter turns', () => {
    const t = makeTransform(100, 200, 90, true);
    const [x, y] = apply(t, 10, 0);
    expect([x, y]).toEqual([100, 190]);
    const [bx, by] = apply(invert(t), x, y);
    expect(bx).toBeCloseTo(10);
    expect(by).toBeCloseTo(0);
  });

  it('bounds arcs through their extreme angles', () => {
    const b = arcBBox(0, 0, 10, 45, 90);
    expect(b.maxY).toBeCloseTo(10);
    expect(b.minX).toBeCloseTo(-Math.SQRT1_2 * 10);
  });
});

describe('ObjectStore', () => {
  it('adds, updates and removes inside transactions with undo and redo', () => {
    const s = new ObjectStore({ bounds: box });
    const events = [];
    s.on('change', (e) => events.push(e));
    const a = s.transact('add', () => s.add({ id: 'a', x: 0, y: 0 }));
    expect(s.get('a')).toBe(a);
    s.transact('move', () => s.update('a', { x: 10 }));
    expect(s.get('a').x).toBe(10);
    expect(s.query({ minX: 9, minY: -1, maxX: 11, maxY: 1 }).map((o) => o.id)).toEqual(['a']);
    expect(s.query({ minX: -2, minY: -2, maxX: -1.5, maxY: -1.5 })).toEqual([]);
    s.undo();
    expect(s.get('a').x).toBe(0);
    expect(s.query({ minX: -1, minY: -1, maxX: 1, maxY: 1 }).length).toBe(1);
    s.redo();
    expect(s.get('a').x).toBe(10);
    s.transact('delete', () => s.remove('a'));
    expect(s.get('a')).toBeUndefined();
    s.undo();
    expect(s.get('a').x).toBe(10);
    expect(events.map((e) => e.source)).toEqual(['edit', 'edit', 'undo', 'redo', 'edit', 'undo']);
  });

  it('rejects edits outside a transaction and rolls back on errors', () => {
    const s = new ObjectStore({ bounds: box });
    expect(() => s.add({ id: 'x', x: 0, y: 0 })).toThrow();
    expect(() => s.transact('bad', () => { s.add({ id: 'x', x: 0, y: 0 }); throw new Error('boom'); })).toThrow('boom');
    expect(s.get('x')).toBeUndefined();
    expect(s.canUndo).toBe(false);
  });

  it('merges steps with the same merge key', () => {
    const s = new ObjectStore({ bounds: box });
    s.transact('add', () => s.add({ id: 'a', x: 0, y: 0 }));
    s.transact('nudge', () => s.update('a', { x: 1 }), { mergeKey: 'nudge' });
    s.transact('nudge', () => s.update('a', { x: 2 }), { mergeKey: 'nudge' });
    s.undo();
    expect(s.get('a').x).toBe(0);
  });

  it('tracks the dirty state against the saved revision', () => {
    const s = new ObjectStore({ bounds: box });
    expect(s.dirty).toBe(false);
    s.transact('add', () => s.add({ id: 'a', x: 0, y: 0 }));
    expect(s.dirty).toBe(true);
    s.markSaved();
    expect(s.dirty).toBe(false);
    s.undo();
    expect(s.dirty).toBe(true);
  });
});
