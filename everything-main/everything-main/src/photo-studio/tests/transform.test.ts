import { describe, it, expect } from 'vitest';
import { layer, newDocument, type Transform } from '../src/model/document';
import {
  handles,
  layerLocked,
  normalizeAngle,
  resizeTransform,
  snapTargets,
  snapTranslation,
  transformBounds,
  worldPoint,
} from '../src/model/transform';
const base: Transform = { x: 40, y: 60, width: 200, height: 100, rotation: 0 };
describe('transform geometry', () => {
  it('pins the opposite anchor for every handle on rotated layers', () => {
    for (const rotation of [0, 30, 90, -135])
      for (const handle of Object.keys(handles) as (keyof typeof handles)[]) {
        const t = { ...base, rotation },
          [sx, sy] = handles[handle];
        const anchor = worldPoint(t, (1 - sx) / 2, (1 - sy) / 2);
        const resized = resizeTransform(t, handle, [35, 17], false);
        const next = worldPoint(resized, (1 - sx) / 2, (1 - sy) / 2);
        expect(next[0]).toBeCloseTo(anchor[0], 8);
        expect(next[1]).toBeCloseTo(anchor[1], 8);
      }
  });
  it('resizes along local axes and preserves proportions when requested', () => {
    expect(resizeTransform(base, 'se', [50, 0], true)).toEqual({
      ...base,
      width: 250,
      height: 125,
    });
    const rotated = resizeTransform({ ...base, rotation: 90 }, 'e', [0, 50], false);
    expect(rotated.width).toBeCloseTo(250);
    expect(rotated.height).toBe(100);
  });
  it('clamps crossed handles and excessive sizes without invalid geometry', () => {
    for (const proportional of [false, true])
      for (const delta of [
        [-10000, -10000],
        [10000, 10000],
      ] as [number, number][]) {
        const t = resizeTransform(base, 'se', delta, proportional);
        expect(t.width).toBeGreaterThanOrEqual(1);
        expect(t.height).toBeGreaterThanOrEqual(1);
        expect(t.width).toBeLessThanOrEqual(8192);
        expect(t.height).toBeLessThanOrEqual(8192);
        if (proportional) expect(t.width / t.height).toBeCloseTo(2);
      }
  });
  it('computes rotated bounds for edge snapping', () => {
    const b = transformBounds({ ...base, rotation: 90 });
    expect(b.x).toBeCloseTo(90);
    expect(b.y).toBeCloseTo(10);
    expect(b.width).toBeCloseTo(100);
    expect(b.height).toBeCloseTo(200);
  });
  it('snaps the nearest edge or center only within the screen-derived threshold', () => {
    const t = { ...base, x: 3, y: 99 };
    const result = snapTranslation(t, { x: [0, 400], y: [100, 200] }, 6);
    expect(result.transform.x).toBe(0);
    expect(result.transform.y).toBe(100);
    expect(result.guides).toEqual({ x: 0, y: 100 });
    expect(snapTranslation(t, { x: [0], y: [200] }, 0.5).transform).toEqual(t);
  });
  it('excludes selected descendants and hidden groups from snap targets', () => {
    const doc = newDocument(800, 600),
      selected = layer('image', 'Selected', 20, 30);
    const visible = layer('image', 'Other', 100, 100);
    visible.transform.x = 200;
    const hidden = layer('group', 'Hidden', 800, 600);
    hidden.visible = false;
    hidden.children.push(layer('image', 'Invisible', 123, 123));
    doc.layers = [selected, visible, hidden];
    expect(snapTargets(doc, selected).x).toEqual([0, 400, 800, 200, 250, 300]);
    const group = layer('group', 'Selected group', 800, 600);
    group.children = [visible];
    doc.layers.push(group);
    expect(snapTargets({ ...doc, layers: [group] }, group).x).toEqual([0, 400, 800]);
  });
  it('respects ancestor locks and wraps rotations', () => {
    const group = layer('group', 'Group', 100, 100),
      child = layer('image', 'Child', 100, 100);
    group.children = [child];
    group.locked = true;
    expect(layerLocked([group], child.id)).toBe(true);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-190)).toBe(170);
  });
});
