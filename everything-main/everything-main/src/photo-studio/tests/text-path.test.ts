import { describe, expect, it } from 'vitest';
import { layoutText, type Measure } from '../src/imaging/text/layout';
import { applyParagraphStyle, defaultCharStyle, fromPlainText, type Align, type TextLayerData, type TypePath } from '../src/imaging/text/model';
import { arcPresetPath, nearestOnPath, pathGeometry, pointAt, reverseKnots, shapeSpans, textRange } from '../src/imaging/text/path-text';
import { textToPath } from '../src/imaging/text/outlines';
import { validateTextData } from '../src/model/text-layer';

// Monospace stand-in: every character is half an em wide; ascent 0.8 em, descent 0.2 em.
const sizeOf = (font: string) => Number(/([\d.]+)px/.exec(font)![1]);
const mono: Measure = (text, font) => {
  const s = sizeOf(font);
  return { width: [...text.replace(/[‌‍]/g, '')].length * s * 0.5, ascent: s * 0.8, descent: s * 0.2 };
};
const style = { ...defaultCharStyle(), size: 20 }; // 10 px per character at 72 ppi

const corner = (x: number, y: number) => [x, y, x, y, x, y];
const line = (x0: number, y0: number, x1: number, y1: number): number[][] => [corner(x0, y0), corner(x1, y1)];
function circle(cx: number, cy: number, r: number): number[][] {
  const k = 0.5522847498307936 * r;
  // Clockwise on screen from the left point.
  return [
    [cx - r, cy + k, cx - r, cy, cx - r, cy - k],
    [cx - k, cy - r, cx, cy - r, cx + k, cy - r],
    [cx + r, cy - k, cx + r, cy, cx + r, cy + k],
    [cx + k, cy + r, cx, cy + r, cx - k, cy + r],
  ];
}

function onPath(text: string, path: Partial<TypePath> & { knots: number[][] }, align: Align = 'left'): TextLayerData {
  return {
    content: applyParagraphStyle(fromPlainText(text, style), 0, text.length, { align }),
    mode: 'point', origin: { x: 0, y: 0 }, orientation: 'horizontal', antiAlias: 'smooth',
    path: { kind: 'path', closed: false, start: 0, end: 1, flip: false, ...path },
  };
}
const layout = (d: TextLayerData) => layoutText(d, { measure: mono });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('path geometry', () => {
  it('measures straight and curved paths', () => {
    expect(pathGeometry(line(0, 0, 30, 40), false).length).toBeCloseTo(50, 9);
    const c = pathGeometry(circle(0, 0, 100), true);
    expect(c.length).toBeCloseTo(2 * Math.PI * 100, 0);
    const p = pointAt(c, c.length / 4); // a quarter from the left point: the top
    expect(p.x).toBeCloseTo(0, 0);
    expect(p.y).toBeCloseTo(-100, 0);
    expect(p.angle).toBeCloseTo(0, 1);
  });
  it('finds the nearest point with a signed normal distance', () => {
    const g = pathGeometry(line(0, 0, 100, 0), false);
    const below = nearestOnPath(g, 40, 7);
    close(below.s, 40);
    close(below.distance, 7); // positive: the descent side (below a left-to-right line)
    close(nearestOnPath(g, 40, -3).distance, -3);
  });
  it('wraps and reverses the text range', () => {
    const base: TypePath = { kind: 'path', knots: [], closed: true, start: 0.75, end: 0.25, flip: false };
    expect(textRange(base, 100)).toEqual({ a: 75, span: 50 });
    // Flipped: the same markers seen from the reversed path.
    const f = textRange({ ...base, flip: true, closed: false, start: 0.2, end: 0.6 }, 100);
    close(f.a, 40);
    close(f.span, 40);
    expect(reverseKnots([[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]])).toEqual([[11, 12, 9, 10, 7, 8], [5, 6, 3, 4, 1, 2]]);
    // Closed paths keep their first knot.
    expect(reverseKnots([corner(0, 0), corner(1, 0), corner(1, 1)], true).map((k) => k[2] + ',' + k[3])).toEqual(['0,0', '1,1', '1,0']);
  });
});

describe('text on a path', () => {
  it('places glyphs along a straight line like point text', () => {
    const l = layout(onPath('abc', { knots: line(10, 50, 210, 50) }));
    expect(l.runs.map((r) => r.text)).toEqual(['a', 'b', 'c']);
    l.runs.forEach((r, i) => {
      close(r.x, 10 + 10 * i);
      close(r.y, 50);
      close(r.angle ?? 0, 0);
    });
    expect(l.overflow).toBe(false);
  });
  it('rotates glyphs to a sloped line and maps carets onto it', () => {
    const l = layout(onPath('ab', { knots: line(0, 0, 60, 80) })); // 3-4-5 slope
    const a = Math.atan2(80, 60);
    for (const r of l.runs) close(r.angle!, a, 1e-9);
    close(l.runs[1].x, 10 * 0.6, 1e-9);
    close(l.runs[1].y, 10 * 0.8, 1e-9);
    const c = l.caretRect(1);
    const [x, y] = l.map!(c.x, c.y + c.height);
    // The caret's bottom sits below the baseline by the descent, along the normal.
    close(x, 6 - 0.8 * c.height * 0 - Math.sin(a) * 4, 1e-6);
    close(y, 8 + Math.cos(a) * 4, 1e-6);
    // Unmapping a point on the path returns the caret index.
    const [ux, uy] = l.unmap!(6.3, 8.1);
    expect(l.hitTest(ux, uy)).toBe(1);
  });
  it('follows a curve, aligning between the markers', () => {
    const r = 100;
    const d = onPath('abcd', { knots: circle(0, 0, r), closed: true, start: 0, end: 0.5 }, 'center');
    const l = layout(d);
    // Half the circle from the left point over the top: the text is centered at the top.
    // The boundary between the second and third glyph is the top of the circle.
    expect(Math.abs(l.runs[2].x)).toBeLessThan(1);
    for (const g of l.runs) {
      // Glyph origins sit on the circle (baseline on the path).
      expect(Math.abs(Math.hypot(g.x, g.y) - r)).toBeLessThan(1);
    }
    // Angles increase clockwise along the top.
    expect(l.runs[0].angle!).toBeLessThan(l.runs[3].angle!);
  });
  it('flips to the other side, reading the other way', () => {
    const r = 100;
    const l = layout(onPath('ab', { knots: circle(0, 0, r), closed: true, start: 0, end: 0.5, flip: true }, 'center'));
    // Reversed travel from the right point over the top: glyphs head left,
    // with their tops toward the center.
    for (const g of l.runs) {
      expect(Math.abs(Math.abs(g.angle!) - Math.PI)).toBeLessThan(0.3);
      const up = [Math.sin(g.angle!), -Math.cos(g.angle!)];
      expect(up[1]).toBeGreaterThan(0.9);
    }
    expect(l.runs[0].x).toBeGreaterThan(0);
    expect(l.runs[1].x).toBeLessThan(l.runs[0].x);
  });
  it('starts at the start marker and hides text past the end marker', () => {
    const l = layout(onPath('abcdef', { knots: line(0, 0, 100, 0), start: 0.2, end: 0.5 }));
    expect(l.runs.map((r) => r.text)).toEqual(['a', 'b', 'c']);
    close(l.runs[0].x, 20);
    expect(l.overflow).toBe(true);
    expect(l.visibleEnd).toBe(3);
  });
  it('places further lines parallel to the path', () => {
    const l = layout(onPath('a\nb', { knots: line(0, 0, 100, 0) }));
    expect(l.runs.length).toBe(2);
    close(l.runs[1].y, 24); // auto leading: 120% of 20 px
  });
  it('carries decorations along the path', () => {
    const d = onPath('abc', { knots: circle(0, 0, 80), closed: true });
    d.content.paragraphs[0].runs[0].style.underline = true;
    const l = layout(d);
    expect(l.decorations[0].points!.length).toBeGreaterThan(3);
  });
  it('outlines rotated glyphs (convert to shape)', () => {
    const d = onPath('l', { knots: line(0, 0, 0, 100) }); // vertical path, heading down
    const square = { unitsPerEm: 1000, ascent: 800, descent: 200 };
    const font = {
      ...square,
      glyphIndex: () => 1, advance: () => 500, kerning: () => 0, normalize: () => [],
      glyph: () => ({ advance: 500, contours: [[{ x: 0, y: 0, on: true }, { x: 500, y: 0, on: true }, { x: 500, y: 700, on: true }, { x: 0, y: 700, on: true }]] }),
    };
    const out = textToPath(d, { fonts: () => font as never });
    // Rotated by 90 degrees: the glyph extends along +y and its ascent toward +x.
    expect(out.bounds.height).toBeCloseTo(10, 6);
    expect(out.bounds.width).toBeCloseTo(14, 6);
    expect(out.bounds.x).toBeCloseTo(0, 6);
  });
  it('validates path data', () => {
    const d = onPath('a', { knots: line(0, 0, 10, 0) });
    expect(() => validateTextData(d)).not.toThrow();
    expect(() => validateTextData({ ...d, path: { ...d.path!, start: 2 } })).toThrow();
    expect(() => validateTextData({ ...d, path: { ...d.path!, knots: [[1, 2]] } })).toThrow();
  });
});

describe('area text', () => {
  const tri: number[][] = [corner(0, 0), corner(200, 0), corner(0, 200)]; // right triangle, widest at the top
  const area = (text: string, knots: number[][], inset = 0): TextLayerData => ({
    content: fromPlainText(text, style), mode: 'paragraph', origin: { x: 0, y: 0 }, box: { width: 1, height: 1 },
    orientation: 'horizontal', antiAlias: 'smooth',
    path: { kind: 'area', knots, closed: true, start: 0, end: 1, flip: false, inset },
  });
  it('finds spans inside a shape', () => {
    const g = pathGeometry(tri, true);
    const s = shapeSpans(g, 50, 70);
    expect(s.length).toBe(1);
    close(s[0][0], 0);
    close(s[0][1], 130); // the band's narrowest row
    const inset = shapeSpans(g, 50, 70, 10);
    close(inset[0][0], 10);
    close(inset[0][1], 110);
  });
  it('breaks lines to the shape width', () => {
    const l = layout(area('aaaa aaaa aaaa aaaa aaaa aaaa aaaa', tri));
    const widths = l.lines.filter((x) => x.visible).map((x) => x.width);
    // Lines get shorter as the triangle narrows.
    expect(widths[0]).toBeGreaterThan(widths[widths.length - 1]);
    for (const ln of l.lines.filter((x) => x.visible)) {
      const room = 200 - (ln.y + ln.descent); // width of the triangle at the line's lowest point
      expect(ln.x + ln.width).toBeLessThanOrEqual(room + 1e-6);
    }
  });
  it('respects the inset and reports overflow', () => {
    const square = [corner(0, 0), corner(60, 0), corner(60, 60), corner(0, 60)];
    const l = layout(area('aa aa aa aa aa aa aa aa aa', square, 5));
    const vis = l.lines.filter((x) => x.visible);
    expect(vis[0].x).toBeCloseTo(5, 6);
    expect(vis[0].y - vis[0].ascent).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(l.overflow).toBe(true);
    expect(vis.length).toBe(2); // 24 px lines in 50 px of height
  });
});

describe('arc presets', () => {
  it('sizes an arch so its length matches the text', () => {
    const p = arcPresetPath('arch', 200, 100, 100, 50);
    const g = pathGeometry(p.knots, p.closed);
    expect(g.length).toBeCloseTo(200, 0);
    // The apex is at the text's baseline center and the ends drop.
    expect(Math.min(...g.ys)).toBeCloseTo(100, 1);
    expect(p.knots[0][3]).toBeGreaterThan(100);
  });
  it('bows downward and closes circles', () => {
    const bow = arcPresetPath('bow', 200, 0, 0, 50);
    expect(bow.knots[0][3]).toBeLessThan(0);
    const c = arcPresetPath('circle', 300, 0, 0, 50);
    expect(c.closed).toBe(true);
    const g = pathGeometry(c.knots, true);
    expect(g.length).toBeCloseTo(600, -1);
    const w = arcPresetPath('wave', 200, 0, 0, 50);
    expect(w.knots.length).toBe(3);
  });
});

describe('PSD path text', () => {
  it('reads a text frame curve as path text', async () => {
    const { importPsdText, importTextPath } = await import('../src/model/psd-text');
    // Two segments of a curve from (0, 0) to (100, 0) through (50, -40).
    const controlPoints = [0, 0, 10, -30, 30, -40, 50, -40, 50, -40, 70, -40, 90, -30, 100, 0];
    const p = importTextPath({ bezierCurve: { controlPoints }, data: { frameMatrix: [1, 0, 0, 1, 5, 6], textRange: [0.5, 2], pathData: { reversed: true } } });
    expect(p).toBeDefined();
    expect(p!.knots.length).toBe(3);
    expect(p!.knots[0].slice(2, 6)).toEqual([5, 6, 15, -24]);
    expect(p!.knots[1]).toEqual([35, -34, 55, -34, 75, -34]);
    expect(p!.knots[2].slice(2, 4)).toEqual([105, 6]);
    expect(p!.start).toBeCloseTo(0.25);
    expect(p!.end).toBe(1);
    expect(p!.flip).toBe(true);
    expect(p!.closed).toBe(false);
    const t = importPsdText({ text: 'Curve', textPath: { bezierCurve: { controlPoints }, data: { frameMatrix: [1, 0, 0, 1, 0, 0], textRange: [0, 2] } } as never }, 72);
    expect(t?.data.path?.kind).toBe('path');
    // Unreadable curves keep the layer raster rather than laying it out straight.
    expect(importPsdText({ text: 'Curve', textPath: { bezierCurve: { controlPoints: [1, 2, 3] }, data: { frameMatrix: [1, 0, 0, 1, 0, 0], textRange: [] } } as never }, 72)).toBeUndefined();
  });
});

describe('editing a type path', () => {
  it('maps the path through the layer and back, keeping arc presets when it only moves', async () => {
    const { textDocMask, setTextMask } = await import('../src/features/vector/state');
    const { layer } = await import('../src/model/document');
    const l = layer('text', 'T', 10, 10);
    const arc = arcPresetPath('arch', 100, 50, 50, 50);
    l.textData = { ...onPath('a', { knots: arc.knots }), path: { kind: 'path', knots: arc.knots, closed: false, start: 0, end: 1, flip: false, arc: { preset: 'arch', bend: 50, x: 50, y: 50, width: 100 } } };
    l.textFrame = { x: 0, y: 0, width: 100, height: 100 };
    l.transform = { x: 200, y: 300, width: 200, height: 200, rotation: 0 }; // scaled 2x and moved
    const m = textDocMask(l);
    expect(m.paths[0].knots[0].points[2]).toBeCloseTo(200 + arc.knots[0][2] * 2, 9);
    expect(m.paths[0].open).toBe(true);
    // Moving every knot keeps the arc (shifted); reshaping drops it.
    for (const k of m.paths[0].knots) for (let i = 0; i < 6; i += 2) k.points[i] += 20;
    const moved = { ...l };
    setTextMask(moved, m);
    const a = moved.textData!.path!.arc!;
    expect([a.preset, a.bend, a.width]).toEqual(['arch', 50, 100]);
    expect(a.x).toBeCloseTo(60, 9);
    expect(a.y).toBeCloseTo(50, 9);
    expect(moved.textData!.path!.knots[0][2]).toBeCloseTo(arc.knots[0][2] + 10, 9);
    m.paths[0].knots[1].points[3] += 30;
    const reshaped = { ...l };
    setTextMask(reshaped, m);
    expect(reshaped.textData!.path!.arc).toBeUndefined();
  });
});
