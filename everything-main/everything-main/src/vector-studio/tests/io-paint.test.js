import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exportSVG } from '../src/features/io/svg-export.js';
import { svgToDocument } from '../src/features/io/svg-import.js';
import { writePDF } from '../src/features/io/pdf.js';
import { paintHooks } from '../src/features/io/outlines.js';
import { nodeArrowheads, arrowTrim, trimAnchors, alignedDash } from '../src/features/paint/stroke-geometry.js';
import { pathLength, pathBounds } from '../src/model/bezier.js';
import { roundCornerAnchors } from '../src/model/round-corners.js';
import { sampleStops } from '../src/model/gradients.js';
import { nodeBounds, unionRect } from '../src/model/geometry.js';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { inflateSync } from 'node:zlib';

const close = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

// The same hooks the paint module installs on the app.
const strokeAnchors = (node) => {
  if (node.type !== 'path' || node.closed) return node.anchors;
  const t = arrowTrim(node);
  return t.start || t.end ? trimAnchors(node.anchors, t.start, t.end) : node.anchors;
};
const fakeApp = {
  arrowheadPaths: (n) => nodeArrowheads(n),
  strokeAnchors,
  dashPattern: (n) => (n.dashAlign === 'corners' && n.dash?.length ? alignedDash(n.dash, pathLength(strokeAnchors(n), n.closed), n.closed) : n.dash?.length ? { dash: n.dash, offset: n.dashOffset || 0 } : null),
};

beforeAll(() => {
  paintHooks.app = fakeApp;
});
afterAll(() => {
  paintHooks.app = null;
});

function docWith(...nodes) {
  const doc = VDocument.create({ width: 200, height: 200 });
  const layer = doc.layers()[0].id;
  doc.transact('build', () => nodes.forEach((n) => doc.insert(n, layer)));
  return doc;
}

const rect = { x: 0, y: 0, w: 200, h: 200 };
const latin1 = (b) => Array.from(b, (c) => String.fromCharCode(c)).join('');
function pdfContent(bytes) {
  const s = latin1(bytes);
  const out = [];
  const re = /<<([^]*?)\/Length (\d+) >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const raw = bytes.subarray(start, start + Number(m[2]));
    out.push(/FlateDecode/.test(m[1]) ? latin1(inflateSync(raw)) : latin1(raw));
  }
  return { text: s, streams: out.join('\n') };
}

describe('paint features in export', () => {
  it('expands gradient midpoints into stops that follow the curve', () => {
    const stops = [{ offset: 0, color: '#000000', opacity: 1, midpoint: 0.2 }, { offset: 1, color: '#ffffff', opacity: 1 }];
    const doc = docWith(createPath(rectangle(0, 0, 100, 100), true, { fill: { type: 'linear', angle: 0, stops }, stroke: null }));
    const svg = exportSVG(doc, { rect });
    const count = (svg.match(/<stop /g) || []).length;
    expect(count).toBeGreaterThan(2);
    // Round trip: the color at the midpoint position is the even mix.
    const back = svgToDocument(svg);
    const s = back.leaves()[0].fill.stops;
    const mid = sampleStops(s, 0.2);
    const v = parseInt(mid.color.slice(1, 3), 16);
    expect(Math.abs(v - 128)).toBeLessThan(6);
    // Without midpoints there are no extra stops.
    const plain = exportSVG(docWith(createPath(rectangle(0, 0, 10, 10), true, { fill: { type: 'linear', angle: 0, stops: [stops[0], stops[1]].map(({ midpoint, ...x }) => x) }, stroke: null })), { rect });
    expect((plain.match(/<stop /g) || []).length).toBe(2);
  });

  it('round trips elliptical radial gradients through gradientTransform', () => {
    const fill = { type: 'radial', stops: [{ offset: 0, color: '#ffffff', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }], x1: 100, y1: 100, x2: 100 + 30 * Math.cos(0.5), y2: 100 + 30 * Math.sin(0.5), aspect: 0.4 };
    const doc = docWith(createPath(ellipse(40, 40, 120, 120), true, { fill, stroke: null }));
    const svg = exportSVG(doc, { rect });
    expect(svg).toMatch(/gradientTransform="translate\(100 100\) rotate\(28\.6479\) scale\(1 0\.4\)"/);
    const back = svgToDocument(svg).leaves()[0].fill;
    close(back.aspect, 0.4);
    close(back.x1, 100);
    close(back.y1, 100);
    close(Math.hypot(back.x2 - back.x1, back.y2 - back.y1), 30);
    close(Math.atan2(back.y2 - back.y1, back.x2 - back.x1), 0.5);
  });

  it('writes arrowheads and the trimmed stroke, and they round trip', () => {
    const line = createPath(
      [
        { x: 20, y: 100, ix: 20, iy: 100, ox: 20, oy: 100 },
        { x: 180, y: 100, ix: 180, iy: 100, ox: 180, oy: 100 },
      ],
      false,
      { fill: null, stroke: { type: 'solid', color: '#ff0000' }, strokeWidth: 4, arrowEnd: { shape: 'triangle', scale: 100, align: 'end' }, arrowStart: { shape: 'circle', scale: 100, align: 'beyond' } },
    );
    const doc = docWith(line);
    const svg = exportSVG(doc, { rect });
    const back = svgToDocument(svg);
    const leaves = back.leaves();
    // Trimmed stroke plus one filled path with both arrowheads.
    expect(leaves).toHaveLength(2);
    const [stroke, arrows] = leaves;
    expect(stroke.fill).toBe(null);
    const trimmed = strokeAnchors(line);
    close(stroke.anchors[stroke.anchors.length - 1].x, trimmed[trimmed.length - 1].x);
    expect(stroke.anchors[stroke.anchors.length - 1].x).toBeLessThan(180);
    expect(arrows.fill).toEqual({ type: 'solid', color: '#ff0000' });
    let expected = null;
    for (const c of nodeArrowheads(line)) expected = unionRect(expected, pathBounds(c.anchors, c.closed));
    const got = nodeBounds(back, arrows);
    for (const k of ['x', 'y', 'w', 'h']) close(got[k], expected[k], 0.01);
    // PDF draws the same pieces.
    return writePDF(doc, [rect]).then(({ bytes }) => {
      const { streams } = pdfContent(bytes);
      expect(streams).toMatch(/\nS\n/);
      expect(streams).toMatch(/\nf\n/);
    });
  });

  it('uses corner-aligned dash patterns', async () => {
    const node = createPath(rectangle(10, 10, 100, 100), true, { fill: null, stroke: { type: 'solid', color: '#000000' }, strokeWidth: 2, dash: [12, 6], dashAlign: 'corners' });
    const doc = docWith(node);
    const d = fakeApp.dashPattern(doc.leaves()[0]);
    expect(d.dash[0]).not.toBe(12);
    const svg = exportSVG(doc, { rect });
    const m = /stroke-dasharray="([^"]+)"/.exec(svg);
    const vals = m[1].split(' ').map(Number);
    close(vals[0], d.dash[0]);
    expect(svg).toContain(`stroke-dashoffset="${Number(d.offset.toFixed(3))}"`);
    const back = svgToDocument(svg).leaves()[0];
    close(back.dash[0], d.dash[0]);
    const { streams } = pdfContent((await writePDF(doc, [rect])).bytes);
    expect(streams).toContain(`[${Number(d.dash[0].toFixed(4))} `);
  });

  it('exports live Round Corners geometry', async () => {
    const node = createPath(rectangle(20, 20, 100, 60), true, { fill: { type: 'solid', color: '#00aa00' }, stroke: null, effects: [{ type: 'roundCorners', radius: 10 }] }, { shape: { kind: 'rect', cx: 70, cy: 50, w: 100, h: 60, radii: [0, 0, 0, 0], angle: 0 } });
    const doc = docWith(node);
    const svg = exportSVG(doc, { rect });
    expect(svg).not.toContain('<rect');
    expect(svg).not.toContain('filter=');
    const back = svgToDocument(svg).leaves()[0];
    const expected = roundCornerAnchors(node.anchors, true, 10);
    expect(back.anchors).toHaveLength(expected.length);
    back.anchors.forEach((a, i) => {
      close(a.x, expected[i].x);
      close(a.y, expected[i].y);
    });
    const { bytes, warnings } = await writePDF(doc, [rect]);
    expect(warnings).toHaveLength(0);
    expect(pdfContent(bytes).streams).toMatch(/ c\n/);
  });

  it('writes filters for every live effect', () => {
    const node = createPath(rectangle(20, 20, 100, 60), true, {
      fill: { type: 'solid', color: '#3366ff' },
      stroke: null,
      effects: [
        { type: 'blur', radius: 2 },
        { type: 'feather', radius: 3 },
        { type: 'innerGlow', blur: 4, color: '#ffffff', opacity: 0.75, mode: 'screen' },
        { type: 'outerGlow', blur: 5, color: '#ffff00', opacity: 0.6 },
        { type: 'dropShadow', x: 3, y: 4, blur: 6, color: '#000000', opacity: 0.5 },
        { type: 'dropShadow', x: 1, y: 1, blur: 1, hidden: true },
      ],
    });
    const svg = exportSVG(docWith(node), { rect });
    expect(svg).toContain('<feComponentTransfer');
    expect(svg).toContain('mode="screen"');
    expect((svg.match(/<feFlood/g) || []).length).toBe(4); // inner glow, two glow passes, shadow
    expect(svg).toContain('stdDeviation="3"'); // shadow blur 6 -> sd 3, feather 3
    expect(svg).toContain('<feMerge>');
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    // Effects come back as effects where they map (blur only here: the importer reads simple filters).
    expect(svg).toContain('filter="url(#');
  });

  it('places elliptical radial shadings with a matrix in PDF', async () => {
    const fill = { type: 'radial', stops: [{ offset: 0, color: '#ffffff', opacity: 1, midpoint: 0.3 }, { offset: 1, color: '#0000ff', opacity: 1 }], aspect: 0.5 };
    const doc = docWith(createPath(ellipse(40, 40, 120, 80), true, { fill, stroke: null }));
    const { bytes } = await writePDF(doc, [rect]);
    const { text, streams } = pdfContent(bytes);
    expect(text).toMatch(/\/Coords \[0 0 0 0 0 [\d.]+\]/);
    expect(text).toMatch(/\/FunctionType 3/); // midpoint samples
    expect(streams).toMatch(/1 0 -?0 0\.5 100 80 cm\n\/Sh1 sh/);
  });

  it('exports global swatch paints as plain colors', () => {
    const doc = docWith(createPath(rectangle(0, 0, 10, 10), true, { fill: { type: 'solid', color: '#123456', swatchId: 'sw1' }, stroke: null }));
    const svg = exportSVG(doc, { rect });
    expect(svg).toContain('fill="#123456"');
    expect(svg).not.toContain('sw1');
  });
});

describe('blends in export', () => {
  it('writes the generated blend steps so files match the canvas', async () => {
    const { createGroup } = await import('../src/model/nodes.js');
    const { blendSteps } = await import('../src/features/artboards/blend-math.js');
    const a = createPath(rectangle(10, 10, 20, 20), true, { fill: { type: 'solid', color: '#ff0000' }, stroke: null });
    const b = createPath(ellipse(150, 100, 40, 40), true, { fill: { type: 'solid', color: '#0000ff' }, stroke: null });
    const doc = VDocument.create({ width: 200, height: 200 });
    const layer = doc.layers()[0].id;
    let gid;
    doc.transact('blend', () => {
      gid = doc.insert(createGroup([a.id, b.id], { blend: { spacing: 'steps', steps: 3 } }), layer, Infinity, [a, b]).id;
    });
    doc.repairParents();
    const steps = blendSteps(doc, doc.get(gid)).runs[0].nodes;
    expect(steps).toHaveLength(3);
    const svg = exportSVG(doc, { rect });
    const back = svgToDocument(svg);
    const leaves = back.leaves();
    expect(leaves).toHaveLength(5);
    expect(leaves[0].fill.color).toBe('#ff0000');
    expect(leaves[4].fill.color).toBe('#0000ff');
    steps.forEach((s, i) => {
      expect(leaves[i + 1].fill.color).toBe(s.fill.color);
      const want = pathBounds(s.anchors, s.closed);
      const got = nodeBounds(back, leaves[i + 1]);
      for (const k of ['x', 'y', 'w', 'h']) close(got[k], want[k], 0.01);
    });
    // The source document is untouched and PDF draws all five shapes.
    expect(doc.get(gid).children).toHaveLength(2);
    const { streams } = pdfContent((await writePDF(doc, [rect])).bytes);
    expect((streams.match(/ rg\n/g) || []).length).toBe(5);
  });
});
