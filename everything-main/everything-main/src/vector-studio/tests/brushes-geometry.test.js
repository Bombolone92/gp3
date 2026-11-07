import { describe, it, expect } from 'vitest';
import { anchor, pathBounds } from '../src/model/bezier.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { buildSpine, spineSampler, nearestOnSpine } from '../src/features/brushes/spine.js';
import { sweepOutline, fitRing, removeFolds } from '../src/features/brushes/outline.js';
import { warpAnchors } from '../src/features/brushes/warp.js';
import { profileFunction, normalizeProfile, flipAlong, flipAcross, insertWidthPoint, isUniformProfile, profileMax, WIDTH_PROFILES } from '../src/features/brushes/width-profile.js';
import { variableWidthShapes, calligraphicShapes, artBrushShapes, patternShapes, scatterShapes, bristleShapes, dashRanges, rng, variableValue, rangeValue } from '../src/features/brushes/generate.js';
import { colorizeColor } from '../src/features/brushes/colorize.js';
import { brushDefaults, artBounds } from '../src/features/brushes/brush-model.js';

const line = (x0, y0, x1, y1) => [anchor(x0, y0), anchor(x1, y1)];
const black = { type: 'solid', color: '#000000' };

/** Point in polygon list with the nonzero rule. */
function winding(rings, x, y) {
  let w = 0;
  for (const pts of rings) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y <= y) {
        if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) w--;
    }
  }
  return w;
}

/** Flatten shape subpaths to polygons for inside tests. */
function polys(shape) {
  return shape.subpaths.map((s) => {
    const out = [];
    const n = s.closed ? s.anchors.length : s.anchors.length - 1;
    for (let i = 0; i < n; i++) {
      const p = s.anchors[i];
      const q = s.anchors[(i + 1) % s.anchors.length];
      for (let k = 0; k < 16; k++) {
        const t = k / 16;
        const mt = 1 - t;
        out.push({
          x: mt ** 3 * p.x + 3 * mt * mt * t * p.ox + 3 * mt * t * t * q.ix + t ** 3 * q.x,
          y: mt ** 3 * p.y + 3 * mt * mt * t * p.oy + 3 * mt * t * t * q.iy + t ** 3 * q.y,
        });
      }
    }
    return out;
  });
}

const inside = (shape, x, y) => winding(polys(shape), x, y) !== 0;

function shapesBounds(shapes) {
  let b = null;
  for (const sh of shapes) {
    for (const s of sh.subpaths) {
      const r = pathBounds(s.anchors, s.closed);
      if (!b) b = { ...r };
      else {
        const x = Math.min(b.x, r.x);
        const y = Math.min(b.y, r.y);
        b = { x, y, w: Math.max(b.x + b.w, r.x + r.w) - x, h: Math.max(b.y + b.h, r.y + r.h) - y };
      }
    }
  }
  return b;
}

describe('spines', () => {
  it('measure arc length and find corners', () => {
    const sp = buildSpine(rectangle(0, 0, 100, 50), true);
    expect(sp.length).toBeCloseTo(300, 5);
    expect(sp.corners).toHaveLength(4);
    // A rectangle drawn clockwise on screen turns right at every corner.
    for (const c of sp.corners) expect(c.turn).toBeGreaterThan(0);
    const at = spineSampler(sp).at;
    const p = at(125);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(25);
    // Closed spines wrap.
    expect(at(325).x).toBeCloseTo(25);
  });

  it('extend open spines past their ends and find nearest points', () => {
    const sp = buildSpine(line(0, 0, 100, 0), false);
    const at = spineSampler(sp).at;
    expect(at(-10).x).toBeCloseTo(-10);
    expect(at(110).x).toBeCloseTo(110);
    const n = nearestOnSpine(sp, 40, 7);
    expect(n.s).toBeCloseTo(40);
    expect(n.d).toBeCloseTo(7);
  });

  it('measure curves accurately', () => {
    const sp = buildSpine(ellipse(0, 0, 100, 100), true);
    expect(sp.length).toBeCloseTo(Math.PI * 100, 0);
    expect(sp.corners).toHaveLength(0);
  });
});

describe('width profiles', () => {
  it('normalize and interpolate smoothly without overshoot', () => {
    const lens = WIDTH_PROFILES.find((p) => p.id === 'lens').points;
    const f = profileFunction(lens);
    expect(f(0).l).toBeCloseTo(0);
    expect(f(0.5).l).toBeCloseTo(1);
    expect(f(1).r).toBeCloseTo(0);
    for (let i = 0; i <= 100; i++) {
      const w = f(i / 100);
      expect(w.l).toBeLessThanOrEqual(1 + 1e-9);
      expect(w.l).toBeGreaterThanOrEqual(0);
    }
    // Symmetric profile, symmetric widths.
    expect(f(0.25).l).toBeCloseTo(f(0.75).l);
    expect(normalizeProfile([{ t: 0.4, l: 2, r: 2 }])).toEqual([
      { t: 0, l: 2, r: 2 },
      { t: 0.4, l: 2, r: 2 },
      { t: 1, l: 2, r: 2 },
    ]);
  });

  it('flip, insert points and step at shared positions', () => {
    const p = [{ t: 0, l: 1, r: 0.5 }, { t: 1, l: 0, r: 0 }];
    expect(flipAlong(p)[0]).toEqual({ t: 0, l: 0, r: 0 });
    expect(flipAcross(p)[0]).toEqual({ t: 0, l: 0.5, r: 1 });
    const { profile, index } = insertWidthPoint(p, 0.5);
    expect(index).toBe(1);
    expect(profile[1].l).toBeCloseTo(0.5);
    const step = profileFunction([{ t: 0, l: 1, r: 1 }, { t: 0.5, l: 1, r: 1 }, { t: 0.5, l: 3, r: 3 }, { t: 1, l: 3, r: 3 }]);
    expect(step(0.25).l).toBeCloseTo(1);
    expect(step(0.75).l).toBeCloseTo(3);
    expect(isUniformProfile([{ t: 0, l: 1, r: 1 }, { t: 1, l: 1, r: 1 }])).toBe(true);
    expect(profileMax(WIDTH_PROFILES.find((q) => q.id === 'keel').points)).toBeCloseTo(1.6);
  });
});

describe('variable width outlines', () => {
  it('follow the profile along a straight line', () => {
    const style = { stroke: black, strokeWidth: 20, strokeCap: 'butt', strokeJoin: 'miter', widthProfile: [{ t: 0, l: 0, r: 0 }, { t: 0.5, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] };
    const [shape] = variableWidthShapes([{ anchors: line(0, 0, 200, 0), closed: false }], style);
    const b = shapesBounds([shape]);
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.w).toBeCloseTo(200, 1);
    expect(b.h).toBeCloseTo(20, 0);
    expect(inside(shape, 100, 9)).toBe(true);
    expect(inside(shape, 100, -9)).toBe(true);
    expect(inside(shape, 100, 11)).toBe(false);
    // Near the tapered ends the outline is thin.
    expect(inside(shape, 10, 5)).toBe(false);
    expect(inside(shape, 10, 0.2)).toBe(true);
  });

  it('use separate widths for each side', () => {
    const style = { stroke: black, strokeWidth: 20, widthProfile: [{ t: 0, l: 2, r: 0.2 }, { t: 1, l: 2, r: 0.2 }] };
    const [shape] = variableWidthShapes([{ anchors: line(0, 0, 100, 0), closed: false }], style);
    // Left of a rightward path is up the screen (negative y).
    expect(inside(shape, 50, -18)).toBe(true);
    expect(inside(shape, 50, 4)).toBe(false);
    expect(inside(shape, 50, 1.5)).toBe(true);
  });

  it('turn corners with joins and no folds, and make a ring on closed paths', () => {
    const style = { stroke: black, strokeWidth: 10, strokeJoin: 'miter', miterLimit: 10, widthProfile: [{ t: 0, l: 1, r: 1 }, { t: 0.5, l: 1.5, r: 1.5 }, { t: 1, l: 1, r: 1 }] };
    const [shape] = variableWidthShapes([{ anchors: rectangle(0, 0, 100, 100), closed: true }], style);
    expect(shape.subpaths).toHaveLength(2);
    expect(inside(shape, 50, 50)).toBe(false);
    expect(inside(shape, 50, 1)).toBe(true);
    // Miter corner reaches the outer corner.
    expect(inside(shape, -4.5, -4.5)).toBe(true);
    // Inner corner is filled solid (no hole from a fold).
    expect(inside(shape, 4, 4)).toBe(true);
    expect(inside(shape, 9, 9)).toBe(false);
  });

  it('round caps extend past the ends and dashes split the outline', () => {
    const style = { stroke: black, strokeWidth: 10, strokeCap: 'round', widthProfile: [{ t: 0, l: 1, r: 1 }, { t: 1, l: 0.5, r: 0.5 }] };
    const [shape] = variableWidthShapes([{ anchors: line(0, 0, 100, 0), closed: false }], style);
    const b = shapesBounds([shape]);
    expect(b.x).toBeCloseTo(-5, 0);
    expect(b.x + b.w).toBeCloseTo(102.5, 0);
    const [dashed] = variableWidthShapes([{ anchors: line(0, 0, 100, 0), closed: false }], { ...style, strokeCap: 'butt' }, { dash: [20, 10] });
    expect(dashed.subpaths).toHaveLength(4);
    expect(dashRanges(100, [20, 10])).toEqual([[0, 20], [30, 50], [60, 80], [90, 100]]);
  });

  it('remove folds but keep real holes', () => {
    // A fold: a small reversed loop on the right side.
    const pts = [{ x: 0, y: 5, s: 0 }, { x: 10, y: 5, s: 10 }, { x: 4, y: 0, s: 10 }, { x: 4, y: 10, s: 14 }, { x: 4, y: 20, s: 20 }];
    const cleaned = removeFolds(pts, -1, 100);
    expect(cleaned.length).toBeLessThan(pts.length);
    expect(cleaned.some((p) => Math.abs(p.x - 4) < 1e-9 && Math.abs(p.y - 5) < 1e-9)).toBe(true);
    // The same loop is kept on the side where it would be a hole.
    expect(removeFolds(pts, 1, 100)).toHaveLength(pts.length);
  });

  it('fit smooth curves with few anchors', () => {
    const sp = buildSpine(ellipse(0, 0, 100, 100), true);
    const rings = sweepOutline(sp, { offset: (side, s, nx, ny) => ({ x: nx * 5, y: ny * 5 }), maxWidth: 10 });
    expect(rings).toHaveLength(2);
    const a = fitRing(rings[0].pts, 0.05);
    expect(a.length).toBeLessThan(40);
    expect(a.length).toBeGreaterThan(3);
  });
});

describe('calligraphic brushes', () => {
  it('sweep an angled flat nib: thin along the nib, wide across it', () => {
    const brush = { ...brushDefaults('calligraphic'), angle: { mode: 'fixed', value: 0, variation: 0 }, roundness: { mode: 'fixed', value: 10, variation: 0 }, size: { mode: 'fixed', value: 20, variation: 0 } };
    const style = { stroke: black, strokeWidth: 1 };
    // A horizontal nib on a horizontal stroke is thin; on a vertical stroke it is wide.
    const [h] = calligraphicShapes([{ anchors: line(0, 0, 100, 0), closed: false }], style, brush);
    const [v] = calligraphicShapes([{ anchors: line(0, 0, 0, 100), closed: false }], style, brush);
    expect(shapesBounds([h]).h).toBeCloseTo(2, 0);
    expect(shapesBounds([v]).w).toBeCloseTo(20, 0);
    // The stroke weight scales the nib.
    const [h2] = calligraphicShapes([{ anchors: line(0, 0, 0, 100), closed: false }], { ...style, strokeWidth: 2 }, brush);
    expect(shapesBounds([h2]).w).toBeCloseTo(40, 0);
  });

  it('vary randomly per stroke and with pressure', () => {
    expect(variableValue({ mode: 'random', value: 10, variation: 4 }, 0, 0.5)).toBe(6);
    expect(variableValue({ mode: 'pressure', value: 10, variation: 4 }, 0, 1)).toBe(14);
    expect(rangeValue({ mode: 'random', min: 2, max: 4 }, 0.5, 0)).toBe(3);
    const brush = { ...brushDefaults('calligraphic'), size: { mode: 'pressure', value: 10, variation: 8 } };
    const thin = calligraphicShapes([{ anchors: line(0, 0, 100, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush, { pressure: [[0, 0], [1, 0]] });
    const thick = calligraphicShapes([{ anchors: line(0, 0, 100, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush, { pressure: [[0, 1], [1, 1]] });
    expect(shapesBounds(thin).h).toBeCloseTo(2, 0);
    expect(shapesBounds(thick).h).toBeCloseTo(18, 0);
    const a = rng(5);
    const b = rng(5);
    expect(a()).toBe(b());
  });
});

const bar = { items: [{ subpaths: [{ anchors: rectangle(0, -5, 100, 10), closed: true }], fill: { type: 'solid', color: '#808080' }, stroke: null }] };
bar.bounds = artBounds(bar.items);

describe('art brushes', () => {
  it('stretch artwork along a straight path', () => {
    const brush = { ...brushDefaults('art'), art: bar };
    const shapes = artBrushShapes([{ anchors: line(0, 0, 300, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush);
    const b = shapesBounds(shapes);
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(300);
    expect(b.h).toBeCloseTo(10);
    // Proportional scaling grows the width with the length.
    const prop = artBrushShapes([{ anchors: line(0, 0, 300, 0), closed: false }], { stroke: black, strokeWidth: 1 }, { ...brush, scaling: 'proportional' });
    expect(shapesBounds(prop).h).toBeCloseTo(30);
  });

  it('bend artwork along curves, keeping its distance from the path', () => {
    const brush = { ...brushDefaults('art'), art: bar };
    // A half circle of radius 100 around (100, 100), from (0, 100) over the top to (200, 100).
    const k = 100 * 0.5522847498307936;
    const arc = [anchor(0, 100, 0, 100, 0, 100 - k), anchor(100, 0, 100 - k, 0, 100 + k, 0), anchor(200, 100, 200, 100 - k, 200, 100)];
    const shapes = artBrushShapes([{ anchors: arc, closed: false }], { stroke: black, strokeWidth: 1 }, brush);
    const [s] = shapes[0].subpaths;
    // Every mapped anchor lies 95..105 from the center.
    for (const a of s.anchors) {
      const d = Math.hypot(a.x - 100, a.y - 100);
      expect(d).toBeGreaterThan(94.9);
      expect(d).toBeLessThan(105.1);
    }
    // Points between anchors too (handles mapped through the Jacobian).
    const pts = polys({ subpaths: [s] })[0];
    for (const p of pts) {
      const d = Math.hypot(p.x - 100, p.y - 100);
      expect(d).toBeGreaterThan(94.5);
      expect(d).toBeLessThan(105.5);
    }
    // The art's top edge (negative y) lands on the left of the path: outside the circle when walking clockwise.
    const top = bar.items[0].subpaths[0].anchors[0];
    expect(top.y).toBe(-5);
  });

  it('flip, keep ends between guides and colorize', () => {
    const tip = { items: [{ subpaths: [{ anchors: rectangle(0, -5, 80, 10), closed: true }], fill: { type: 'solid', color: '#000000' } }, { subpaths: [{ anchors: rectangle(80, -2, 20, 4), closed: true }], fill: { type: 'solid', color: '#ffffff' } }] };
    tip.bounds = artBounds(tip.items);
    const brush = { ...brushDefaults('art'), art: tip, scaling: 'guides', guides: { start: 0, end: 0.8 }, colorize: { method: 'tints', key: '#000000' } };
    const shapes = artBrushShapes([{ anchors: line(0, 0, 400, 0), closed: false }], { stroke: { type: 'solid', color: '#ff0000' }, strokeWidth: 1 }, brush);
    // The 20-long tip keeps its length at the end of a 400-long path.
    const tipB = shapesBounds([shapes[1]]);
    expect(tipB.x).toBeCloseTo(380);
    expect(tipB.w).toBeCloseTo(20);
    expect(shapes[0].fill.color).toBe('#ff0000');
    expect(shapes[1].fill.color).toBe('#ffffff');
    const flipped = artBrushShapes([{ anchors: line(0, 0, 400, 0), closed: false }], { stroke: black, strokeWidth: 1 }, { ...brush, flipAlong: true });
    expect(shapesBounds([flipped[1]]).x).toBeCloseTo(0);
  });

  it('map warped handles smoothly (warpAnchors)', () => {
    const out = warpAnchors(line(0, 0, 10, 0), false, (x, y) => ({ x: x * 2, y: y + 1 }), 100);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ x: 20, y: 1 });
  });
});

const tileArt = (w, h, color = '#000000') => {
  const items = [{ subpaths: [{ anchors: rectangle(0, -h / 2, w, h), closed: true }], fill: { type: 'solid', color } }];
  return { items, bounds: artBounds(items) };
};

describe('pattern brushes', () => {
  it('fit whole side tiles between corners and place corner tiles on corners', () => {
    const brush = { ...brushDefaults('pattern'), tiles: { side: tileArt(10, 6), outer: tileArt(6, 6, '#ff0000'), inner: tileArt(6, 6, '#00ff00'), start: null, end: null } };
    const shapes = patternShapes([{ anchors: rectangle(0, 0, 100, 100), closed: true }], { stroke: black, strokeWidth: 1 }, brush);
    const corners = shapes.filter((s) => s.fill.color === '#ff0000');
    const sides = shapes.filter((s) => s.fill.color === '#000000');
    // Clockwise rectangle: four outer corners, no inner ones.
    expect(corners).toHaveLength(4);
    expect(shapes.filter((s) => s.fill.color === '#00ff00')).toHaveLength(0);
    const cb = corners.map((c) => shapesBounds([c]));
    for (const b of cb) {
      expect(b.w).toBeCloseTo(6, 1);
      expect(b.h).toBeCloseTo(6, 1);
    }
    expect(cb.some((b) => Math.abs(b.x + 3) < 1e-6 && Math.abs(b.y + 3) < 1e-6)).toBe(true);
    // Each side: 94 units between corner tiles -> 9 stretched tiles.
    expect(sides).toHaveLength(36);
    const top = sides.map((s) => shapesBounds([s])).filter((b) => b.y < 0 && b.y > -4);
    const minX = Math.min(...top.map((b) => b.x));
    const maxX = Math.max(...top.map((b) => b.x + b.w));
    expect(minX).toBeCloseTo(3, 1);
    expect(maxX).toBeCloseTo(97, 1);
  });

  it('use inner corner tiles where the path turns left, and start/end tiles on open paths', () => {
    const brush = { ...brushDefaults('pattern'), tiles: { side: tileArt(10, 6), outer: tileArt(6, 6, '#ff0000'), inner: tileArt(6, 6, '#00ff00'), start: tileArt(5, 6, '#0000ff'), end: tileArt(5, 6, '#ffff00') } };
    // Right then up: a left turn on screen.
    const path = [anchor(0, 100), anchor(100, 100), anchor(100, 0)];
    const shapes = patternShapes([{ anchors: path, closed: false }], { stroke: black, strokeWidth: 1 }, brush);
    expect(shapes.filter((s) => s.fill.color === '#00ff00')).toHaveLength(1);
    expect(shapes.filter((s) => s.fill.color === '#ff0000')).toHaveLength(0);
    const start = shapesBounds(shapes.filter((s) => s.fill.color === '#0000ff'));
    const end = shapesBounds(shapes.filter((s) => s.fill.color === '#ffff00'));
    expect(start.x).toBeCloseTo(0);
    expect(start.w).toBeCloseTo(5);
    expect(end.y).toBeCloseTo(0);
    expect(end.h).toBeCloseTo(5);
  });

  it('add space instead of stretching', () => {
    const brush = { ...brushDefaults('pattern'), fit: 'space', tiles: { side: tileArt(10, 6), outer: 'auto', inner: 'auto' } };
    const shapes = patternShapes([{ anchors: line(0, 0, 105, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush);
    expect(shapes).toHaveLength(10);
    for (const s of shapes) expect(shapesBounds([s]).w).toBeCloseTo(10);
  });
});

describe('scatter and bristle brushes', () => {
  it('scatter copies along the path at the spacing', () => {
    const dot = tileArt(10, 10);
    const brush = { ...brushDefaults('scatter'), art: dot, spacing: { mode: 'fixed', min: 200, max: 200 } };
    const shapes = scatterShapes([{ anchors: line(0, 0, 100, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush);
    // Copies every 20 units: 0, 20, ..., 100.
    expect(shapes).toHaveLength(6);
    expect(shapesBounds([shapes[1]]).x).toBeCloseTo(15);
    const rotated = scatterShapes([{ anchors: line(0, 0, 0, 100), closed: false }], { stroke: black, strokeWidth: 1 }, { ...brush, art: tileArt(10, 2), rotateRelative: 'path' });
    // Along a vertical path, rotation relative to the path stands the art up.
    expect(shapesBounds([rotated[1]]).h).toBeCloseTo(10);
  });

  it('paint many translucent bristles', () => {
    const brush = { ...brushDefaults('bristle'), size: 10, density: 50 };
    const shapes = bristleShapes([{ anchors: line(0, 0, 200, 0), closed: false }], { stroke: black, strokeWidth: 1 }, brush, { seed: 3 });
    expect(shapes.length).toBeGreaterThan(20);
    for (const s of shapes) {
      expect(s.stroke.opacity).toBeLessThan(1);
      expect(s.fill).toBe(null);
    }
    const b = shapesBounds(shapes);
    expect(b.h).toBeLessThan(14);
    expect(b.h).toBeGreaterThan(6);
  });
});

describe('colorization', () => {
  it('maps colors by method', () => {
    expect(colorizeColor('#000000', 'tints', '#ff0000')).toBe('#ff0000');
    expect(colorizeColor('#ffffff', 'tints', '#ff0000')).toBe('#ffffff');
    expect(colorizeColor('#000000', 'tintsShades', '#ff0000')).toBe('#000000');
    expect(colorizeColor('#808080', 'tintsShades', '#ff0000')).toBe('#ff0101');
    expect(colorizeColor('#00ff00', 'hueShift', '#0000ff', '#00ff00')).toBe('#0000ff');
    expect(colorizeColor('#ff0000', 'hueShift', '#0000ff', '#00ff00')).toBe('#00ff00');
    expect(colorizeColor('#123456', 'none', '#ff0000')).toBe('#123456');
  });
});
