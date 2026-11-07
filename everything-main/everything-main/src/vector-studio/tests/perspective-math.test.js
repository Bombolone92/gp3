import { describe, it, expect } from 'vitest';
import { defaultGrid, gridFromSettings, settingsOf, camera, planeFrame, toDoc, toFlat, jacobian, localScale, projectAnchors, normalizeGrid, PLANES } from '../src/features/perspective/grid-math.js';
import { gridHandles, dragHandle, worldOn } from '../src/features/perspective/handles.js';
import { ellipse, rectangle } from '../src/model/shapes.js';

const board = { x: 0, y: 0, w: 612, h: 792 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Points along a projected anchor list (cubic segments). */
function sample(anchors, closed, steps = 12) {
  const out = [];
  const n = closed ? anchors.length : anchors.length - 1;
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const mt = 1 - t;
      out.push({
        x: mt ** 3 * a.x + 3 * mt * mt * t * a.ox + 3 * mt * t * t * b.ix + t ** 3 * b.x,
        y: mt ** 3 * a.y + 3 * mt * mt * t * a.oy + 3 * mt * t * t * b.iy + t ** 3 * b.y,
      });
    }
  }
  return out;
}

describe('perspective camera', () => {
  it('builds orthogonal axes for every grid type', () => {
    for (const type of ['one', 'two', 'three']) {
      const cam = camera(defaultGrid(type, board));
      expect(Math.abs(dot(cam.A, cam.B))).toBeLessThan(1e-9);
      expect(Math.abs(dot(cam.A, cam.U))).toBeLessThan(1e-9);
      expect(Math.abs(dot(cam.B, cam.U))).toBeLessThan(1e-9);
      expect(cam.U[1]).toBeLessThan(0); // up is up on the page
    }
  });

  it('puts the vanishing points where the grid says', () => {
    const g = defaultGrid('two', board);
    const right = planeFrame(g, 'right', 0);
    const far = toDoc(right, g.ox + 1e7, g.oy);
    expect(far.x).toBeCloseTo(g.vr, 0);
    expect(far.y).toBeCloseTo(g.horizon, 0);
    const left = planeFrame(g, 'left', 0);
    const farL = toDoc(left, g.ox - 1e7, g.oy);
    expect(farL.x).toBeCloseTo(g.vl, 0);
    expect(farL.y).toBeCloseTo(g.horizon, 0);
    // Verticals of a bird's eye view converge on the third point below.
    const g3 = defaultGrid('three', board);
    const down = toDoc(planeFrame(g3, 'right', 0), g3.ox, g3.oy + 1e9);
    expect(down.x).toBeCloseTo(g3.v3.x, 0);
    expect(down.y).toBeCloseTo(g3.v3.y, 0);
  });

  it('maps the corner line at true size and keeps flat artwork unmirrored', () => {
    for (const type of ['one', 'two', 'three']) {
      const g = defaultGrid(type, board);
      for (const plane of PLANES) {
        const f = planeFrame(g, plane, 0);
        const o = toDoc(f, g.ox, g.oy);
        expect(o.x).toBeCloseTo(g.ox, 6);
        expect(o.y).toBeCloseTo(g.oy, 6);
        const J = jacobian(f.H, g.ox, g.oy);
        expect(J[0] * J[3] - J[1] * J[2]).toBeGreaterThan(0);
      }
      if (type !== 'three') {
        // A vertical plane's up direction is a true-size vertical at the corner.
        const p = toDoc(planeFrame(g, 'right', 0), g.ox, g.oy - 100);
        expect(p.x).toBeCloseTo(g.ox, 6);
        expect(p.y).toBeCloseTo(g.oy - 100, 6);
      }
    }
    // The one-point front plane is the page itself.
    const g1 = defaultGrid('one', board);
    const q = toDoc(planeFrame(g1, 'left', 0), 123, 456);
    expect(q.x).toBeCloseTo(123, 6);
    expect(q.y).toBeCloseTo(456, 6);
  });

  it('round-trips points between the page and every plane', () => {
    for (const type of ['one', 'two', 'three']) {
      const g = defaultGrid(type, board);
      for (const plane of PLANES) {
        const f = planeFrame(g, plane, 30);
        for (const [x, y] of [
          [g.ox - 40, g.oy - 60],
          [g.ox + 70, g.oy - 20],
          [g.ox + 5, g.oy - 140],
        ]) {
          const p = toDoc(f, x, y);
          const back = toFlat(f, p.x, p.y);
          if (!back) continue;
          expect(back.x).toBeCloseTo(x, 6);
          expect(back.y).toBeCloseTo(y, 6);
        }
      }
    }
  });

  it('refuses points beyond the horizon of a plane', () => {
    const g = defaultGrid('two', board);
    const floor = planeFrame(g, 'floor', 0);
    expect(toFlat(floor, g.ox, g.horizon - 50)).toBe(null);
    expect(toFlat(floor, g.ox, g.horizon + 50)).not.toBe(null);
  });

  it('foreshortens with distance', () => {
    const g = defaultGrid('two', board);
    const f = planeFrame(g, 'right', 0);
    expect(localScale(f, g.ox + 400, g.oy)).toBeLessThan(localScale(f, g.ox + 10, g.oy));
  });
});

describe('projecting paths', () => {
  it('keeps straight segments exact', () => {
    const g = defaultGrid('two', board);
    const f = planeFrame(g, 'right', 0);
    const r = rectangle(g.ox + 20, g.oy - 120, 100, 80);
    const p = projectAnchors(f, r, true);
    expect(p).toHaveLength(4);
    r.forEach((a, i) => {
      const q = toDoc(f, a.x, a.y);
      expect(p[i].x).toBeCloseTo(q.x, 9);
      expect(p[i].y).toBeCloseTo(q.y, 9);
      expect(p[i].ox).toBeCloseTo(q.x, 9);
    });
  });

  it('projects curves to within a small fraction of a point', () => {
    for (const type of ['one', 'two', 'three']) {
      const g = defaultGrid(type, board);
      for (const plane of PLANES) {
        const f = planeFrame(g, plane, 0);
        const cx = plane === 'left' ? g.ox - 150 : g.ox + 150;
        const cy = g.oy - (plane === 'floor' ? -0 : 120);
        const c = ellipse(cx - 80, cy - 60, 160, 120);
        const pts = sample(projectAnchors(f, c, true), true);
        let worst = 0;
        for (const s of pts) {
          const q = toFlat(f, s.x, s.y);
          if (!q) continue;
          const e = Math.abs(Math.hypot((q.x - cx) / 80, (q.y - cy) / 60) - 1) * 80;
          worst = Math.max(worst, e);
        }
        expect(worst).toBeLessThan(0.75);
      }
    }
  });
});

describe('grid settings and controls', () => {
  it('turns Define Grid settings into a grid and back', () => {
    const g = gridFromSettings({ type: 'two', angle: 30, distance: 400, horizonHeight: 180, cell: 24 }, board);
    const s = settingsOf(g);
    expect(s.angle).toBeCloseTo(30, 6);
    expect(s.distance).toBeCloseTo(400, 6);
    expect(s.horizonHeight).toBeCloseTo(180, 6);
    expect(camera(g).d).toBeCloseTo(400, 6);
    const one = gridFromSettings({ type: 'one', distance: 300, horizonHeight: 100 }, board);
    expect(settingsOf(one).distance).toBe(300);
    const three = gridFromSettings({ type: 'three', third: { x: 0, y: 1000 } }, board);
    expect(settingsOf(three).third.y).toBeCloseTo(1000, 6);
  });

  it('repairs damaged grids from files', () => {
    const g = normalizeGrid({ type: 'two', vl: 'x', extent: { left: 50 } }, board);
    expect(Number.isFinite(g.vl)).toBe(true);
    expect(g.extent.left).toBe(50);
    expect(g.extent.right).toBeGreaterThan(0);
    expect(normalizeGrid(null, board).type).toBe('two');
  });

  it('offers controls for each grid type', () => {
    const ids = (t) => gridHandles(defaultGrid(t, board)).map((h) => h.id);
    expect(ids('two')).toEqual(expect.arrayContaining(['vl', 'vr', 'station', 'horizon-l', 'origin', 'extent-left', 'extent-right', 'extent-height', 'cell', 'plane-left', 'plane-right', 'plane-floor']));
    expect(ids('one')).toContain('vx');
    expect(ids('one')).not.toContain('vl');
    expect(ids('three')).toContain('v3');
  });

  it('drags vanishing points, the horizon and the whole grid', () => {
    const g = defaultGrid('two', board);
    const a = dragHandle(g, 'vr', { x: g.vr + 50, y: g.horizon }, { delta: { dx: 50, dy: 0 } });
    expect(a.vr).toBeCloseTo(g.vr + 50);
    expect(a.vl).toBe(g.vl);
    const locked = dragHandle(g, 'vr', { x: 0, y: 0 }, { lockStation: true, delta: { dx: 50, dy: 0 } });
    expect(locked.vl).toBeCloseTo(g.vl + 50);
    expect(locked.px).toBeCloseTo(g.px + 50);
    // Viewing angle and distance stay when the station point is locked.
    expect(settingsOf(locked).angle).toBeCloseTo(settingsOf(g).angle, 6);
    const hz = dragHandle(g, 'horizon-l', { x: 0, y: 0 }, { delta: { dx: 0, dy: -30 } });
    expect(hz.horizon).toBeCloseTo(g.horizon - 30);
    const moved = dragHandle(g, 'origin', { x: 0, y: 0 }, { delta: { dx: 10, dy: 20 } });
    expect(moved.ox - g.ox).toBeCloseTo(10);
    expect(moved.horizon - g.horizon).toBeCloseTo(20);
    expect(moved.vr - g.vr).toBeCloseTo(10);
    // A vanishing point cannot cross the station point.
    const bad = dragHandle(g, 'vl', { x: 0, y: 0 }, { delta: { dx: 5000, dy: 0 } });
    expect(bad.vl).toBeLessThan(g.px);
  });

  it('drags extents, cell size and plane positions through the ground', () => {
    const g = defaultGrid('two', board);
    const handles = Object.fromEntries(gridHandles(g).map((h) => [h.id, h]));
    // Dragging a control onto its own position changes nothing.
    const same = dragHandle(g, 'extent-right', handles['extent-right'], {});
    expect(same.extent.right).toBeCloseTo(g.extent.right, 6);
    const pl = dragHandle(g, 'plane-right', handles['plane-right'], {});
    expect(pl.planes.right).toBeCloseTo(0, 6);
    // Move the right plane toward the left vanishing point by 60 world units.
    const f = planeFrame(g, 'floor', 0);
    const target = (() => {
      const cam = camera(g);
      const Q = [0, 1, 2].map((i) => cam.O[i] + 60 * cam.B[i] + (g.extent.right / 2) * cam.A[i]);
      return { x: cam.px + (cam.d * Q[0]) / Q[2], y: cam.py + (cam.d * Q[1]) / Q[2] };
    })();
    void f;
    const moved = dragHandle(g, 'plane-right', target, {});
    expect(moved.planes.right).toBeCloseTo(60, 4);
    expect(worldOn(g, 'floor', 0, target).b).toBeCloseTo(60, 4);
    const snapped = dragHandle(g, 'plane-right', target, { snap: true });
    expect(snapped.planes.right).toBeCloseTo(60, 4); // 60 = 2 cells
    const h = dragHandle(g, 'extent-height', handles['extent-height'], {});
    expect(h.extent.height).toBeCloseTo(g.extent.height, 4);
    const c = dragHandle(g, 'cell', handles.cell, {});
    expect(c.cell).toBeCloseTo(g.cell, 4);
  });

  it('keeps three-point grids valid', () => {
    const g = defaultGrid('three', board);
    // The third point cannot leave the span between the other two.
    const bad = dragHandle(g, 'v3', { x: 0, y: 0 }, { delta: { dx: 5000, dy: 0 } });
    expect(bad).toBe(g);
    const ok = dragHandle(g, 'v3', { x: 0, y: 0 }, { delta: { dx: 20, dy: 100 } });
    expect(ok.v3.y).toBeCloseTo(g.v3.y + 100);
  });
});
