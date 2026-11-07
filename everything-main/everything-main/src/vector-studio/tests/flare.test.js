import { describe, it, expect, beforeEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { nodeBounds, transformNodes } from '../src/model/geometry.js';
import { liveArtwork, isLive, expandLive } from '../src/model/live.js';
import { hitTest } from '../src/render/hit.js';
import { applyStyle, commonStyle } from '../src/ops/paint-ops.js';
import { createFlare, flareParts, rng, transformFlare, endFromOptions } from '../src/features/flare/flare-model.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('flare model', () => {
  it('builds center, halo, rays and rings deterministically', () => {
    const f = createFlare(100, 100, { rays: { number: 8 }, rings: { number: 5, path: 200, direction: 0 } });
    expect(f.ex).toBeCloseTo(300);
    expect(f.ey).toBeCloseTo(100);
    const parts = flareParts(f);
    expect(parts.filter((p) => p.role === 'ray')).toHaveLength(8);
    expect(parts.filter((p) => p.role === 'ring')).toHaveLength(5);
    expect(parts.filter((p) => p.role === 'center')).toHaveLength(1);
    expect(flareParts(f)).toEqual(parts);
    const off = flareParts({ ...f, rays: { ...f.rays, on: false }, rings: { ...f.rings, on: false } });
    expect(off.map((p) => p.role)).toEqual(['halo', 'center']);
    // Rings sit on the line from the center to the end point.
    for (const r of parts.filter((p) => p.role === 'ring')) expect(r.fill.y1).toBeCloseTo(100);
    const a = rng(7);
    const b = rng(7);
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it('moves and scales its parameters', () => {
    const f = createFlare(0, 0, { center: { diameter: 50 } }, { ex: 10, ey: 0 });
    const t = transformFlare(f, [2, 0, 0, 2, 5, 5]);
    expect(t).toMatchObject({ cx: 5, cy: 5, ex: 25, ey: 5 });
    expect(t.center.diameter).toBe(100);
    expect(endFromOptions(0, 0, { path: 10, direction: 90 }).ey).toBeCloseTo(-10);
  });
});

describe('flare tool', () => {
  let app;
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('flare');
  });

  it('drags to place a flare, then clicks to place its rings', async () => {
    const t = app.tool;
    t.onPointerDown(ev(app, 200, 200));
    t.onPointerMove(ev(app, 260, 200));
    await t.onPointerUp(ev(app, 260, 200));
    const doc = app.editor.doc;
    const f = doc.get([...app.editor.selection][0]);
    expect(f.type).toBe('flare');
    expect(isLive(f)).toBe(true);
    // The drag reaches the halo edge: 60 = R * (1 + 0.2 * 4).
    expect(f.center.diameter).toBeCloseTo((2 * 60) / 1.8);
    t.onPointerDown(ev(app, 400, 300));
    await t.onPointerUp(ev(app, 400, 300));
    expect(doc.get(f.id)).toMatchObject({ ex: 400, ey: 300 });
    expect(doc.undoLabel).toBe('Flare');
    // Drag the center handle.
    t.onPointerDown(ev(app, 200, 200));
    t.onPointerMove(ev(app, 210, 220));
    await t.onPointerUp(ev(app, 210, 220));
    expect(doc.get(f.id)).toMatchObject({ cx: 210, cy: 220, ex: 410, ey: 320 });
    const b = nodeBounds(doc, doc.get(f.id));
    expect(b.x).toBeLessThan(180);
    expect(hitTest(doc, 210, 220, 1)?.id).toBe(f.id);
  });

  it('clicks to enter options and edits a flare by double-clicking it', async () => {
    const t = app.tool;
    t.onPointerDown(ev(app, 100, 100));
    const up = t.onPointerUp(ev(app, 100, 100));
    await tick();
    let dlg = document.querySelector('dialog');
    expect(dlg.querySelector('h2').textContent).toBe('Flare Tool Options');
    const input = (label) => document.getElementById([...dlg.querySelectorAll('label')].find((l) => l.textContent === label).htmlFor);
    input('Diameter').value = '40 pt';
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await up;
    const doc = app.editor.doc;
    const f = doc.get([...app.editor.selection][0]);
    expect(f.center.diameter).toBe(40);
    expect(f.cx).toBe(100);
    app.setTool('selection');
    app.tool.onDoubleClick(ev(app, 100, 100));
    await tick();
    dlg = document.querySelector('dialog');
    expect(dlg.querySelector('h2').textContent).toBe('Flare Options');
    const rays = input('Number');
    rays.value = '4';
    rays.dispatchEvent(new Event('input', { bubbles: true }));
    expect(liveArtwork(doc, doc.get(f.id)).items.length).toBe(1 + 4 + 1 + 10);
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await tick();
    expect(doc.get(f.id).rays.number).toBe(4);
    expect(doc.undoLabel).toBe('Flare Options');
  });

  it('recolors, transforms and expands', () => {
    const doc = app.editor.doc;
    const f = createFlare(50, 50);
    doc.transact('Flare', () => doc.insert(f, app.editor.targetLayer().id));
    app.editor.select([f.id]);
    applyStyle(app.editor, { fill: { type: 'solid', color: '#ffcc00' } });
    expect(doc.get(f.id).color).toBe('#ffcc00');
    expect(commonStyle(app.editor, 'fill')).toEqual({ type: 'solid', color: '#ffcc00' });
    doc.transact('Move', () => transformNodes(doc, [f.id], [1, 0, 0, 1, 10, 0]));
    expect(doc.get(f.id).cx).toBe(60);
    let g;
    doc.transact('Expand', () => (g = expandLive(doc, f.id)));
    expect(g.type).toBe('group');
    expect(g.children.length).toBeGreaterThan(10);
    expect(doc.get(g.children[0]).fill.type).toBe('radial');
  });

  it('exports as gradient artwork', async () => {
    const doc = app.editor.doc;
    doc.transact('Flare', () => doc.insert(createFlare(200, 200), app.editor.targetLayer().id));
    const { writePDF } = await import('../src/features/io/pdf.js');
    const { bytes } = await writePDF(doc, [doc.artboards[0]], { compress: false });
    const pdf = new TextDecoder('latin1').decode(bytes);
    expect(pdf).toContain('/ShadingType 3');
    expect(pdf).toContain('/ShadingType 2');
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain('<linearGradient');
  });
});
