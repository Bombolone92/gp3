import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installCanvasStub } from './helpers.js';
import { makeImage } from './trace-helpers.js';
import { VDocument } from '../src/model/document.js';
import { createImage, defaultLabel } from '../src/model/nodes.js';
import { liveArtwork, isLive, expandLive } from '../src/model/live.js';
import { nodeBounds, transformNodes } from '../src/model/geometry.js';
import { hitTest } from '../src/render/hit.js';
import { translate } from '../src/lib/matrix.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { setPixelSource } from '../src/features/trace/trace-runner.js';
import { computeTrace, TraceService } from '../src/features/trace/trace-service.js';
import { isTrace, makeTrace, releaseTrace, expandTrace, updateTrace, needsTrace, amendNode, traceKey } from '../src/features/trace/trace-live.js';
import { presetOptions } from '../src/features/trace/presets.js';

const scene = (x, y) => ((x - 30) ** 2 + (y - 30) ** 2 < 15 ** 2 ? [220, 30, 30] : x > 50 && x < 75 && y > 20 && y < 50 ? [20, 60, 200] : [250, 250, 250]);
const pixels = makeImage(80, 60, scene, 2);

beforeAll(() => {
  installCanvasStub();
  setPixelSource((doc, assetId) => (assetId === 'missing' ? null : pixels));
});
afterAll(() => setPixelSource(null));

function setup() {
  const doc = VDocument.create({ width: 400, height: 300 });
  const layer = doc.layers()[0].id;
  doc.assets.set('img1', { mime: 'image/png', data: 'data:image/png;base64,AAAA' });
  // 80 x 60 pixels placed at 2x and moved to (10, 20).
  const img = createImage('img1', 80, 60, [2, 0, 0, 2, 10, 20]);
  doc.transact('place', () => doc.insert(img, layer));
  return { doc, layer, imgId: img.id };
}

async function traced(opts = presetOptions('colors-3')) {
  const s = setup();
  const result = await computeTrace(s.doc, s.doc.get(s.imgId), opts);
  let t;
  s.doc.transact('Trace Image', () => {
    t = makeTrace(s.doc, s.imgId, { options: opts, preset: 'colors-3', result });
  });
  return { ...s, id: t.id, result };
}

describe('trace objects', () => {
  it('wrap the image as live artwork with a stored result', async () => {
    const { doc, id, imgId, layer, result } = await traced();
    const t = doc.get(id);
    expect(isTrace(t)).toBe(true);
    expect(isLive(t)).toBe(true);
    expect(defaultLabel(t)).toBe('<Traced Image>');
    expect(t.parent).toBe(layer);
    expect(t.children).toEqual([imgId]);
    expect(t.live.result.key).toBe(traceKey(doc, 'img1', t.live.options));
    expect(needsTrace(doc, t)).toBe(false);
    expect(result.stats.paths).toBeGreaterThanOrEqual(3);
    // The selection box is the image's.
    expect(nodeBounds(doc, t)).toMatchObject({ x: 10, y: 20, w: 160, h: 120 });
    // Generated shapes are in document space through the image transform.
    const { items } = liveArtwork(doc, t);
    expect(items).toHaveLength(result.shapes.length);
    for (const n of items) {
      const b = nodeBounds(doc, n.type === 'compound' ? { ...n, children: [] } : n) || { x: 10, y: 20, w: 0, h: 0 };
      expect(b.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(20 - 1e-6);
    }
    expect(items.some((n) => n.fill?.color && n.fill.color.startsWith('#'))).toBe(true);
  });

  it('follow transforms of the object', async () => {
    const { doc, id } = await traced();
    const before = liveArtwork(doc, doc.get(id)).items.find((n) => n.type === 'path');
    doc.transact('move', () => transformNodes(doc, [id], translate(100, 50)));
    const after = liveArtwork(doc, doc.get(id)).items.find((n) => n.type === 'path');
    expect(after.anchors[0].x).toBeCloseTo(before.anchors[0].x + 100);
    expect(after.anchors[0].y).toBeCloseTo(before.anchors[0].y + 50);
  });

  it('select as one object and hit test the result', async () => {
    const { doc, imgId } = await traced();
    // The red disc's center in document space: (10 + 30 * 2, 20 + 30 * 2).
    expect(hitTest(doc, 70, 80, 1)?.id).toBe(imgId);
  });

  it('show the chosen view without changing the result', async () => {
    const { doc, id, imgId, result } = await traced();
    const view = (v) => {
      doc.transact('view', () => updateTrace(doc, id, { view: v }));
      return liveArtwork(doc, doc.get(id)).items;
    };
    expect(view('source').map((n) => n.id)).toEqual([imgId]);
    const outlines = view('outlines');
    expect(outlines).toHaveLength(result.shapes.length);
    expect(outlines.every((n) => !n.fill && n.stroke)).toBe(true);
    expect(view('resultOutlines')).toHaveLength(result.shapes.length * 2);
    const withSource = view('outlinesSource');
    expect(withSource[0].type).toBe('image');
    expect(withSource[0].opacity).toBeLessThan(1);
    expect(doc.get(id).live.result).toBe(result);
    expect(needsTrace(doc, doc.get(id))).toBe(false);
  });

  it('expand to grouped, editable paths of the result whatever the view', async () => {
    const { doc, id, result, layer } = await traced();
    doc.transact('view', () => updateTrace(doc, id, { view: 'outlines' }));
    let g;
    doc.transact('Expand', () => (g = expandTrace(doc, id)));
    expect(doc.get(id)).toBeUndefined();
    expect(g.type).toBe('group');
    expect(isLive(g)).toBe(false);
    expect(g.parent).toBe(layer);
    expect(g.children).toHaveLength(result.shapes.length);
    for (const c of g.children) {
      const n = doc.get(c);
      expect(['path', 'compound']).toContain(n.type);
      expect(n.fill).toBeTruthy();
      expect(c).not.toContain('~');
    }
    // No image is left behind.
    expect(doc.leaves().some((n) => n.type === 'image')).toBe(false);
    doc.undo();
    expect(isTrace(doc.get(id))).toBe(true);
  });

  it('expand through the generic Expand too', async () => {
    const { doc, id } = await traced();
    let g;
    doc.transact('Expand', () => (g = expandLive(doc, id)));
    expect(g.children.length).toBeGreaterThan(0);
  });

  it('release back to the image in place', async () => {
    const { doc, id, imgId, layer } = await traced();
    let out;
    doc.transact('Release', () => (out = releaseTrace(doc, id)));
    expect(out).toBe(imgId);
    expect(doc.get(id)).toBeUndefined();
    expect(doc.get(imgId).parent).toBe(layer);
    expect(doc.get(layer).children).toEqual([imgId]);
    doc.undo();
    expect(doc.get(imgId).parent).toBe(id);
  });

  it('export the traced artwork', async () => {
    const { doc, result } = await traced();
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
    expect((svg.match(/<path/g) || []).length).toBeGreaterThanOrEqual(result.shapes.length);
    expect(svg).not.toContain('<image');
  });

  it('survive saving and loading', async () => {
    const { doc, id } = await traced();
    const copy = VDocument.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    const t = copy.get(id);
    expect(needsTrace(copy, t)).toBe(false);
    expect(liveArtwork(copy, t).items.length).toBe(liveArtwork(doc, doc.get(id)).items.length);
  });
});

describe('re-tracing', () => {
  it('stores new results in place, keeping undo and redo consistent', async () => {
    const { doc, id, result } = await traced();
    const service = new TraceService(null, { delay: 0 });
    const bw = presetOptions('bw');
    doc.transact('Trace Options', () => updateTrace(doc, id, { options: bw, preset: 'bw' }));
    expect(needsTrace(doc, doc.get(id))).toBe(true);
    // The earlier result still draws meanwhile.
    expect(liveArtwork(doc, doc.get(id)).items.length).toBe(result.shapes.length);
    const undoDepth = doc.undoStack.length;
    expect(await service.refresh(doc, id)).toBe(true);
    const t = doc.get(id);
    expect(needsTrace(doc, t)).toBe(false);
    expect(t.live.result.shapes.every((s) => s.f === '#000000')).toBe(true);
    expect(doc.undoStack.length).toBe(undoDepth);
    doc.undo();
    expect(doc.get(id).live.options.mode).toBe('color');
    expect(doc.get(id).live.result).toBe(result);
    doc.redo();
    expect(doc.get(id).live.options.mode).toBe('bw');
    expect(needsTrace(doc, doc.get(id))).toBe(false);
  });

  it('re-trace automatically after option changes', async () => {
    const { doc, id } = await traced();
    const service = new TraceService(null, { delay: 0 });
    service.watch(doc);
    doc.transact('Trace Options', () => updateTrace(doc, id, { options: { ...presetOptions('colors-3'), colors: 2 } }));
    expect(service.isBusy(doc, id)).toBe(true);
    for (let i = 0; i < 100 && service.isBusy(doc, id); i++) await new Promise((r) => setTimeout(r, 10));
    expect(service.isBusy(doc, id)).toBe(false);
    expect(needsTrace(doc, doc.get(id))).toBe(false);
    expect(doc.get(id).live.result.stats.colors).toBe(2);
  });

  it('drop results that no longer match', async () => {
    const { doc, id } = await traced();
    const old = doc.get(id).live.result;
    doc.transact('Trace Options', () => updateTrace(doc, id, { options: presetOptions('bw') }));
    const { applyResult } = await import('../src/features/trace/trace-live.js');
    expect(applyResult(doc, id, old)).toBe(false);
  });

  it('amend nodes only outside transactions', async () => {
    const { doc, id } = await traced();
    const tx = doc.begin('drag');
    expect(amendNode(doc, id, { name: 'x' })).toBe(false);
    tx.cancel();
    expect(amendNode(doc, id, { name: 'x' })).toBe(true);
    expect(doc.get(id).name).toBe('x');
  });

  it('report unreadable images', async () => {
    const { doc, imgId } = setup();
    doc.assets.set('missing', { mime: 'image/png', data: '' });
    doc.transact('x', () => doc.update(imgId, { asset: 'missing' }));
    await expect(computeTrace(doc, doc.get(imgId), presetOptions('bw'))).rejects.toThrow(/could not be read/);
  });

  it('cancel with an abort signal', async () => {
    const { doc, imgId } = setup();
    const c = new AbortController();
    const p = computeTrace(doc, doc.get(imgId), presetOptions('bw'), { signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
