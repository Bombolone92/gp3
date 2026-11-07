import { describe, it, expect, beforeAll, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { installCanvasStub, bootAppWithFeatures } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { transformNodes, nodeBounds } from '../src/model/geometry.js';
import { translate, scale } from '../src/lib/matrix.js';
import { hitTest } from '../src/render/hit.js';
import { drawHooks } from '../src/render/draw.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { exportView } from '../src/features/io/export-view.js';
import { writePDF } from '../src/features/io/pdf.js';
import { lattice, copiesIn, previewCopies, fraction, tileOutline, artBounds, addPattern, findPattern, patternPaint, usedPatternIds, PATTERN_DEFAULTS } from '../src/features/patterns/model.js';
import { scaleBucket, bakePattern, patternColor, cellBitmap } from '../src/features/patterns/render.js';
import { editLayer, editTile, defFromLayer, setOptions } from '../src/features/patterns/edit.js';
import { dragTile } from '../src/features/patterns/tile-tool.js';
import { patternLibraries } from '../src/features/patterns/libraries.js';
import { swatchesOf, swatchRows } from '../src/features/paint/swatch-model.js';

beforeAll(() => installCanvasStub());

const solid = (color) => ({ type: 'solid', color });

function dotDef(extra = {}) {
  const dot = createPath(ellipse(2, 2, 6, 6), true, { fill: solid('#ff0000'), stroke: null });
  return { ...PATTERN_DEFAULTS, id: 'pat-test', name: 'Dots', width: 10, height: 10, art: { roots: [dot.id], nodes: [{ ...dot, parent: null }] }, ...extra };
}

function docWithPattern(def = dotDef(), fillTransform = null) {
  const doc = VDocument.create({ width: 200, height: 200 });
  const layer = doc.layers()[0].id;
  const r = createPath(rectangle(0, 0, 40, 30), true, { fill: patternPaint(def.id, fillTransform), stroke: solid('#000000'), strokeWidth: 2 });
  doc.transact('setup', () => {
    addPattern(doc, def);
    doc.insert(r, layer);
  });
  return { doc, id: r.id, layer };
}

describe('pattern tiling geometry', () => {
  it('parses brick offsets', () => {
    expect(fraction('1/3')).toEqual({ p: 1, q: 3, v: 1 / 3 });
    expect(fraction('5/3').v).toBe(0.5);
    expect(fraction('junk').v).toBe(0.5);
  });

  it('reduces every tile type to a rectangular repeating cell', () => {
    const base = { width: 10, height: 20, brickOffset: '1/3' };
    expect(lattice({ ...base, tileType: 'grid' }).cell).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    expect(lattice({ ...base, tileType: 'brickRow' }).cell).toEqual({ x: 0, y: 0, w: 10, h: 60 });
    expect(lattice({ ...base, tileType: 'brickColumn' }).cell).toEqual({ x: 0, y: 0, w: 30, h: 20 });
    expect(lattice({ ...base, tileType: 'hexColumn' }).cell).toEqual({ x: 0, y: 0, w: 15, h: 20 });
    expect(lattice({ ...base, tileType: 'hexRow' }).cell).toEqual({ x: 0, y: 0, w: 10, h: 30 });
    // The cell vectors are lattice vectors: (cell.w, 0) = i*a + j*b for integers i, j.
    for (const tileType of ['grid', 'brickRow', 'brickColumn', 'hexColumn', 'hexRow']) {
      const { a, b, cell } = lattice({ ...base, tileType });
      for (const [vx, vy] of [[cell.w, 0], [0, cell.h]]) {
        const det = a[0] * b[1] - a[1] * b[0];
        const i = (vx * b[1] - vy * b[0]) / det;
        const j = (vy * a[0] - vx * a[1]) / det;
        expect(Math.abs(i - Math.round(i))).toBeLessThan(1e-9);
        expect(Math.abs(j - Math.round(j))).toBeLessThan(1e-9);
      }
    }
  });

  it('finds the copies covering a region, in overlap order', () => {
    const def = { ...dotDef(), tileType: 'grid' };
    const art = artBounds(def);
    const copies = copiesIn(def, { x: 0, y: 0, w: 30, h: 20 }, art);
    // Dots at 2..8 in each 10pt tile: 3 columns x 2 rows touch the rect.
    expect(copies.length).toBe(6);
    // Left in front: within a row, copies further left draw later; top rows draw last.
    expect(copies[0].dy).toBeGreaterThan(copies[copies.length - 1].dy);
    expect(copies[0].dx).toBeGreaterThan(copies[1].dx);
    const right = copiesIn({ ...def, overlapH: 'right', overlapV: 'bottom' }, { x: 0, y: 0, w: 30, h: 20 }, art);
    expect(right[0].dx).toBeLessThan(right[1].dx);
    expect(right[0].dy).toBeLessThan(right[right.length - 1].dy);
  });

  it('lays preview copies out as a visual grid for brick and hex tiles', () => {
    for (const tileType of ['grid', 'brickRow', 'brickColumn', 'hexColumn', 'hexRow']) {
      const copies = previewCopies({ width: 10, height: 10, tileType, brickOffset: '1/2' }, '3x3');
      expect(copies.length).toBe(9);
      expect(copies.filter((c) => c.center).length).toBe(1);
      for (const c of copies) {
        expect(Math.abs(c.dx)).toBeLessThanOrEqual(15);
        expect(Math.abs(c.dy)).toBeLessThanOrEqual(15);
      }
    }
    expect(previewCopies({ width: 10, height: 10 }, '1x3').length).toBe(3);
  });

  it('outlines hex tiles as hexagons', () => {
    expect(tileOutline({ width: 10, height: 10, tileType: 'grid' }).length).toBe(4);
    expect(tileOutline({ width: 10, height: 10, tileType: 'hexRow' }).length).toBe(6);
  });

  it('buckets device scales in half octaves', () => {
    expect(scaleBucket(1)).toBe(1);
    expect(scaleBucket(1.1)).toBeCloseTo(Math.SQRT2);
    expect(scaleBucket(3)).toBe(4);
    expect(scaleBucket(0)).toBe(1);
  });
});

describe('pattern paints', () => {
  it('render through the paint hook as a canvas pattern placed by the paint transform', () => {
    const { doc, id } = docWithPattern(dotDef(), [2, 0, 0, 2, 5, 5]);
    const set = vi.fn();
    const pattern = { setTransform: set };
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.createPattern = () => pattern;
    globalThis.DOMMatrix ||= class {
      constructor(m) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = m;
      }
    };
    const style = drawHooks.paintStyle(ctx, doc, doc.get(id), doc.get(id).fill);
    expect(style).toBe(pattern);
    const m = set.mock.calls[0][0];
    expect(m.e).toBe(5);
    expect(m.f).toBe(5);
    // Pattern units are scaled by 2 into the document and by the bitmap's pixel density.
    const bmp = cellBitmap(doc, findPattern(doc, 'pat-test'), 2);
    expect(m.a).toBeCloseTo((2 * 10) / bmp.pw);
  });

  it('hit test as filled', () => {
    const { doc, id } = docWithPattern();
    expect(hitTest(doc, 20, 15, 1)?.id).toBe(id);
  });

  it('move with the object when Transform Patterns is on, and stay put otherwise', () => {
    const { doc, id } = docWithPattern();
    doc.transact('move', () => transformNodes(doc, [id], translate(10, 5)));
    expect(doc.get(id).fill.transform).toEqual([1, 0, 0, 1, 10, 5]);
    doc.transact('move', () => transformNodes(doc, [id], translate(10, 5), { transformPatterns: false }));
    expect(doc.get(id).fill.transform).toEqual([1, 0, 0, 1, 10, 5]);
    expect(nodeBounds(doc, doc.get(id)).x).toBe(20);
  });

  it('can transform only the pattern', () => {
    const { doc, id } = docWithPattern();
    const before = doc.get(id).anchors;
    doc.transact('scale pattern', () => transformNodes(doc, [id], scale(2, 2), { transformObjects: false }));
    expect(doc.get(id).anchors).toBe(before);
    expect(doc.get(id).fill.transform).toEqual([2, 0, 0, 2, 0, 0]);
    doc.transact('nothing', () => transformNodes(doc, [id], scale(2, 2), { transformObjects: false, transformPatterns: false }));
    expect(doc.get(id).fill.transform).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('export to SVG as a native pattern with the art written once', () => {
    const { doc } = docWithPattern(dotDef({ tileType: 'brickRow' }), [1, 0, 0, 1, 3, 4]);
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 200, h: 200 } });
    expect(svg).toMatch(/<pattern id="[^"]+" patternUnits="userSpaceOnUse" width="10" height="20" patternTransform="matrix\(1 0 0 1 3 4\)">/);
    expect(svg).toMatch(/fill="url\(#pat\d+\)"/);
    expect((svg.match(/<use /g) || []).length).toBeGreaterThanOrEqual(3);
    expect((svg.match(/<g id="pa\d+">/g) || []).length).toBe(1);
    expect(svg).toContain('xmlns:xlink');
  });

  it('bake into clipped tile copies for PDF and print', async () => {
    const { doc, id } = docWithPattern();
    const view = exportView(doc);
    const g = view.get(id);
    expect(g.type).toBe('group');
    const clip = view.get(g.children[0]);
    expect(clip.clip).toBe(true);
    const tiles = view.get(clip.children[0]);
    // 40 x 30 rect over 10pt tiles (plus the stroke's reach): at least 4 x 3 copies.
    expect(tiles.children.length).toBeGreaterThanOrEqual(12);
    expect(view.get(g.children[1]).fill).toBeNull();
    const { bytes } = await writePDF(doc, [{ x: 0, y: 0, w: 200, h: 200 }]);
    const s = Buffer.from(bytes).toString('latin1');
    const streams = [...s.matchAll(/<<([^]*?)\/Length (\d+) >>\nstream\n/g)].map((m) => {
      const start = m.index + m[0].length;
      const raw = bytes.subarray(start, start + Number(m[2]));
      return /FlateDecode/.test(m[1]) ? inflateSync(raw).toString('latin1') : Buffer.from(raw).toString('latin1');
    });
    expect(streams.join('\n')).toMatch(/1 0 0 rg/);
  });

  it('fall back to the main color for type and missing art', () => {
    const def = dotDef();
    expect(patternColor(def)).toBe('#ff0000');
    expect(patternColor(null)).toBe('#808080');
    const doc = VDocument.create();
    doc.transact('p', () => addPattern(doc, def));
    const t = { id: 't1', type: 'text', fill: patternPaint(def.id), stroke: null, transform: [1, 0, 0, 1, 0, 0], text: 'Hi', x: 0, y: 0, char: {}, para: {} };
    expect(bakePattern(t, doc, new Map()).fill).toEqual(solid('#ff0000'));
  });

  it('lists pattern ids in use, including nested ones', () => {
    const { doc } = docWithPattern();
    expect([...usedPatternIds(doc)]).toEqual(['pat-test']);
  });
});

describe('pattern libraries', () => {
  it('provide original, well-formed pattern swatches', () => {
    const libs = patternLibraries();
    expect(libs.length).toBeGreaterThanOrEqual(3);
    const ids = new Set();
    for (const lib of libs) {
      for (const s of lib.swatches) {
        expect(s.paint).toEqual({ type: 'pattern', id: s.pattern.id });
        expect(ids.has(s.pattern.id)).toBe(false);
        ids.add(s.pattern.id);
        expect(s.pattern.width).toBeGreaterThan(0);
        expect(artBounds(s.pattern)).toBeTruthy();
        const nodeIds = s.pattern.art.nodes.map((n) => n.id);
        expect(new Set(nodeIds).size).toBe(nodeIds.length);
      }
    }
  });
});

describe('pattern editing mode', () => {
  it('makes a pattern from the selection, edits it and writes it back on Done', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument({ width: 300, height: 300 });
    const doc = ed.doc;
    const r = createPath(rectangle(20, 20, 10, 10), true, { fill: solid('#00ff00'), stroke: null });
    doc.transact('add', () => doc.insert(r, doc.layers()[0].id));
    ed.select([r.id]);
    await app.commands.run('pattern.make');
    const layer = editLayer(doc);
    expect(layer).toBeTruthy();
    expect(ed.isolation).toBe(layer.id);
    expect(layer.children.length).toBe(1);
    // The original stays in the document.
    expect(doc.has(r.id)).toBe(true);
    const sw = swatchesOf(doc).find((s) => s.paint?.type === 'pattern');
    expect(sw.name).toBe('New Pattern');
    expect(swatchRows(doc, { show: 'pattern' }).length).toBe(1);
    expect(editTile(doc, layer)).toEqual({ x: 20, y: 20, w: 10, h: 10 });
    // Pattern options are undoable document edits.
    setOptions(ed, { tileType: 'hexRow', sizeToArt: true, hSpacing: 4, vSpacing: 2 });
    expect(editTile(doc, editLayer(doc))).toEqual({ x: 18, y: 19, w: 14, h: 12 });
    doc.undo();
    expect(editLayer(doc).pattern.tileType).toBe('grid');
    doc.redo();
    await app.commands.run('pattern.done');
    expect(editLayer(doc)).toBeNull();
    expect(ed.isolation).toBeNull();
    const def = findPattern(doc, sw.paint.id);
    expect(def.tileType).toBe('hexRow');
    expect(def.width).toBe(14);
    expect(def.art.roots.length).toBe(1);
    // Art is stored in pattern units with the tile at the origin.
    expect(nodeBounds(doc, def.art.nodes[0]).x).toBeCloseTo(2);
    // Undo returns to editing mode, undo again leaves it.
    doc.undo();
    expect(editLayer(doc)).toBeTruthy();
    app.closeDocument(ed, { force: true });
  });

  it('cancels a new pattern, removing its swatch', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const before = swatchesOf(ed.doc).length;
    await app.commands.run('pattern.make');
    expect(swatchesOf(ed.doc).length).toBe(before + 1);
    expect(app.root.classList.contains('pattern-editing')).toBe(true);
    await app.commands.run('pattern.cancel');
    expect(swatchesOf(ed.doc).length).toBe(before);
    expect(ed.doc.root.patterns).toEqual([]);
  });

  it('edits an existing pattern from its swatch, and Esc finishes', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const def = dotDef();
    ed.doc.transact('p', () => addPattern(ed.doc, def));
    await app.commands.run('pattern.edit', { patternId: def.id });
    const layer = editLayer(ed.doc);
    expect(layer.children.length).toBe(1);
    const t = editTile(ed.doc, layer);
    expect(t.w).toBe(10);
    // Move the art: the tile moves with it.
    ed.doc.transact('move', () => transformNodes(ed.doc, layer.children, translate(3, 0)));
    expect(editTile(ed.doc, editLayer(ed.doc)).x).toBeCloseTo(t.x + 3);
    await app.commands.run('object.exitIsolation');
    expect(editLayer(ed.doc)).toBeNull();
    expect(findPattern(ed.doc, def.id).art.nodes.length).toBe(1);
  });

  it('saves a copy as a new swatch while editing', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const def = dotDef();
    ed.doc.transact('p', () => addPattern(ed.doc, def));
    await app.commands.run('pattern.edit', { patternId: def.id });
    const { savePatternCopy } = await import('../src/features/patterns/edit.js');
    const id = savePatternCopy(app, ed, 'Copy of Dots');
    expect(findPattern(ed.doc, id).name).toBe('Copy of Dots');
    expect(swatchesOf(ed.doc).some((s) => s.paint?.id === id)).toBe(true);
    expect(defFromLayer(ed.doc, editLayer(ed.doc)).art.nodes.length).toBe(1);
  });

  it('drags the tile with the tile tool geometry', () => {
    const t0 = { x: 0, y: 0, w: 10, h: 10 };
    expect(dragTile(t0, 'move', 5, 2)).toEqual({ x: 5, y: 2, w: 10, h: 10 });
    expect(dragTile(t0, 'e', 5, 0)).toEqual({ x: 0, y: 0, w: 15, h: 10 });
    expect(dragTile(t0, 'nw', 2, 2)).toEqual({ x: 2, y: 2, w: 8, h: 8 });
    expect(dragTile(t0, 'se', 10, 0, { shift: true })).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(dragTile(t0, 'e', 5, 0, { alt: true })).toEqual({ x: -5, y: 0, w: 20, h: 10 });
  });

  it('shows the Transform Objects / Transform Patterns options for pattern-painted selections', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const def = dotDef();
    const r = createPath(rectangle(0, 0, 40, 30), true, { fill: patternPaint(def.id), stroke: null });
    ed.doc.transact('p', () => {
      addPattern(ed.doc, def);
      ed.doc.insert(r, ed.doc.layers()[0].id);
    });
    ed.select([r.id]);
    const done = app.commands.run('object.transform.move');
    await new Promise((res) => setTimeout(res, 0));
    const dialog = document.querySelector('dialog[open]');
    const labels = [...dialog.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toContain('Transform Objects');
    expect(labels).toContain('Transform Patterns');
    const objects = [...dialog.querySelectorAll('.form-row.check')].find((row) => row.textContent === 'Transform Objects').querySelector('input');
    objects.checked = false;
    const inputs = dialog.querySelectorAll('input[type="text"]');
    inputs[0].value = '7';
    [...dialog.querySelectorAll('.btn')].find((b) => b.textContent === 'OK').click();
    await done;
    expect(ed.doc.get(r.id).fill.transform).toEqual([1, 0, 0, 1, 7, 0]);
    expect(nodeBounds(ed.doc, ed.doc.get(r.id)).x).toBe(0);
  });
});
