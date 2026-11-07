import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { clipboard, segmentRuns } from '../src/ops/clipboard.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function drag(app, from, to, mods = {}) {
  const t = app.tool;
  t.onPointerDown(ev(app, from[0], from[1], mods));
  t.onPointerMove(ev(app, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods));
  t.onPointerMove(ev(app, to[0], to[1], mods));
  t.onPointerUp(ev(app, to[0], to[1], mods));
}
const pts = (n) => n.anchors.map((a) => [a.x, a.y]);

let app;
let doc;
function addRect(x, y, w, h) {
  const n = createPath(rectangle(x, y, w, h), true, { fill: null, stroke: { type: 'solid', color: '#000000' } });
  doc.transact('r', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}

beforeEach(() => {
  app = bootApp();
  app.newDocument();
  app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  app.editor.setViewOption('alignmentGuides', false);
  doc = app.editor.doc;
  app.setTool('direct-selection');
});

describe('segmentRuns', () => {
  it('joins consecutive segments and wraps around closed paths', () => {
    const p = { anchors: rectangle(0, 0, 10, 10), closed: true };
    expect(segmentRuns(p, [3, 0]).map((r) => r.anchors.map((a) => [a.x, a.y]))).toEqual([[[0, 10], [0, 0], [10, 0]]]);
    expect(segmentRuns(p, [0, 2]).length).toBe(2);
    expect(segmentRuns(p, [0, 1, 2, 3])[0].closed).toBe(true);
    const open = { anchors: rectangle(0, 0, 10, 10), closed: false };
    expect(segmentRuns(open, [2, 0]).map((r) => r.anchors.length)).toEqual([2, 2]);
  });
});

describe('Cut and Copy with a partial Direct Selection', () => {
  it('Cut with one anchor selected copies its two segments and leaves the rest', async () => {
    const r = addRect(100, 100, 100, 100);
    app.editor.selectAnchors(r.id, [0]);
    await app.commands.run('edit.cut');
    expect(doc.leaves().map(pts)).toEqual([[[200, 100], [200, 200], [100, 200]]]);
    expect(doc.undoLabel).toBe('Cut');
    expect(clipboard.data.items).toHaveLength(1);
    const piece = clipboard.data.items[0].nodes[0];
    expect(piece.closed).toBe(false);
    expect(pts(piece)).toEqual([[100, 200], [100, 100], [200, 100]]);
    expect(clipboard.data.bounds).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    await app.commands.run('edit.pasteFront');
    expect(doc.leaves().map(pts)).toContainEqual([[100, 200], [100, 100], [200, 100]]);
  });

  it('Cut after a marquee across segments cuts just those segments', async () => {
    addRect(100, 100, 100, 100);
    drag(app, [90, 140], [210, 160]); // across both sides
    await app.commands.run('edit.cut');
    expect(doc.leaves().map(pts)).toEqual([[[200, 200], [100, 200]], [[100, 100], [200, 100]]]);
    expect(clipboard.data.items.map((i) => pts(i.nodes[0]))).toEqual([[[200, 100], [200, 200]], [[100, 200], [100, 100]]]);
  });

  it('Copy of a clicked segment copies only that segment', async () => {
    const r = addRect(100, 100, 100, 100);
    app.tool.onPointerDown(ev(app, 150, 100));
    app.tool.onPointerUp(ev(app, 150, 100));
    await app.commands.run('edit.copy');
    expect(clipboard.data.items.map((i) => pts(i.nodes[0]))).toEqual([[[100, 100], [200, 100]]]);
    expect(doc.get(r.id).closed).toBe(true);
  });

  it('a wholly selected path still copies whole', async () => {
    const r = addRect(100, 100, 100, 100);
    app.editor.select([r.id]);
    await app.commands.run('edit.cut');
    expect(doc.leaves()).toHaveLength(0);
    expect(clipboard.data.items[0].nodes[0].closed).toBe(true);
  });
});

describe('System clipboard SVG of partial copies', () => {
  it('exports the copied segments as an open path', async () => {
    const { clipboardSVG } = await import('../src/features/io/lazy.js');
    const r = addRect(100, 100, 100, 100);
    app.editor.selectAnchors(r.id, [0]);
    await app.commands.run('edit.copy');
    const svg = clipboardSVG(clipboard.data, 'test');
    expect(svg).toMatch(/<path[^>]* d="M/);
    expect(svg).not.toMatch(/Z"/);
  });
});
