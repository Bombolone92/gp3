import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { makeImage } from './trace-helpers.js';
import { createImage, createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { setPixelSource } from '../src/features/trace/trace-runner.js';
import { setPixelEncoder, cropImage, cropToPixels, tileColors, buildMosaic, mosaicLayout, squareRows, makePixelPerfect, effectivePpi } from '../src/features/trace/image-ops.js';
import { resizeCrop, initialCropRect } from '../src/features/trace/crop.js';
import { isTrace } from '../src/features/trace/trace-live.js';
import { traceSettings } from '../src/features/trace/trace-commands.js';
import { MENUS } from '../src/ui/menus.js';

// 40 x 20 pixels: left half red, right half blue.
const pixels = makeImage(40, 20, (x) => (x < 20 ? [230, 20, 20] : [20, 20, 230]));
const encoded = [];

beforeAll(() => {
  setPixelSource(() => pixels);
  setPixelEncoder((px, mime) => {
    encoded.push(px);
    return `data:${mime};base64,${px.width}x${px.height}`;
  });
});
afterAll(() => {
  setPixelSource(null);
  setPixelEncoder(null);
});

async function appWithImage() {
  const app = await bootAppWithFeatures();
  const ed = app.newDocument({ width: 400, height: 300 });
  const doc = ed.doc;
  doc.assets.set('pic', { mime: 'image/png', data: 'data:image/png;base64,AAAA' });
  const img = createImage('pic', 40, 20, [2, 0, 0, 2, 50, 60]);
  doc.transact('place', () => doc.insert(img, doc.layers()[0].id));
  ed.select([img.id]);
  return { app, ed, doc, imgId: img.id };
}

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('trace commands', () => {
  it('are in the Object and Window menus', async () => {
    const app = await bootAppWithFeatures();
    const object = MENUS.find((m) => m.label === 'Object');
    const sub = object.submenu.find((i) => i.label === 'Trace Image');
    for (const id of sub.submenu) expect(app.commands.get(id), id).toBeTruthy();
    for (const id of ['object.cropImage', 'object.mosaic', 'object.pixelPerfect', 'panel.traceImage']) expect(app.commands.get(id), id).toBeTruthy();
    expect(app.commands.isEnabled('trace.make')).toBe(false);
  });

  it('make, expand and release trace objects', async () => {
    const { app, ed, doc, imgId } = await appWithImage();
    expect(app.commands.isEnabled('trace.make')).toBe(true);
    await app.commands.run('trace.make');
    await flush();
    const t = doc.get([...ed.selection][0]);
    expect(isTrace(t)).toBe(true);
    expect(t.children).toEqual([imgId]);
    expect(t.live.preset).toBe(traceSettings(app).preset);
    expect(app.commands.isEnabled('trace.release')).toBe(true);
    expect(app.commands.isEnabled('trace.make')).toBe(false);
    // Selecting the source image inside still targets the trace object.
    ed.select([imgId]);
    expect(app.commands.isEnabled('trace.expand')).toBe(true);
    app.commands.run('trace.release');
    expect(doc.get(t.id)).toBeUndefined();
    expect([...ed.selection]).toEqual([imgId]);
    await app.commands.run('trace.makeExpand');
    await flush();
    const g = doc.get([...ed.selection][0]);
    expect(g.type).toBe('group');
    expect(isTrace(g)).toBe(false);
    expect(g.children.length).toBeGreaterThanOrEqual(2);
    expect(doc.get(imgId)).toBeUndefined();
    doc.undo();
    expect(doc.get(imgId).type).toBe('image');
  });
});

describe('Trace Image panel', () => {
  it('edits the selected trace object and shows its counts', async () => {
    const { app, ed, doc } = await appWithImage();
    await app.commands.run('trace.make');
    await flush();
    const id = [...ed.selection][0];
    app.openPanel('traceImage');
    const panel = document.querySelector('.panel-traceImage');
    expect(panel).toBeTruthy();
    const mode = [...panel.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'gray'));
    mode.value = 'bw';
    mode.dispatchEvent(new Event('change'));
    expect(doc.get(id).live.options.mode).toBe('bw');
    expect(doc.get(id).live.preset).toBe(null);
    // The service re-traces in the background.
    for (let i = 0; i < 200 && app.traceService.isBusy(doc, id); i++) await new Promise((r) => setTimeout(r, 10));
    expect(doc.get(id).live.result.shapes.every((s) => s.f === '#000000' || s.f === '#ffffff')).toBe(true);
    // Quick preset buttons apply presets.
    const quick = panel.querySelector('[data-preset="grays"]');
    quick.click();
    expect(doc.get(id).live.options.mode).toBe('gray');
    expect(doc.get(id).live.preset).toBe('grays');
    expect(quick.getAttribute('aria-pressed')).toBe('true');
    app.dock.update();
    await flush();
    expect(panel.querySelector('.trace-stat-value').textContent).not.toBe('–');
    for (let i = 0; i < 200 && app.traceService.isBusy(doc, id); i++) await new Promise((r) => setTimeout(r, 10));
  });

  it('sets the options for the next trace when nothing is traced', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.openPanel('traceImage');
    const panel = document.querySelector('.panel-traceImage');
    panel.querySelector('[data-preset="line-art"]').click();
    expect(traceSettings(app).preset).toBe('line-art');
    expect(traceSettings(app).options.strokes).toBe(true);
    expect(panel.querySelector('.trace-hint').textContent).toMatch(/Select a placed image/);
  });
});

describe('Properties panel', () => {
  it('offers tracing, cropping and mosaic for an image', async () => {
    const { app } = await appWithImage();
    app.openPanel('properties');
    app.dock.update();
    await flush();
    const text = document.querySelector('.panel-properties').textContent;
    expect(text).toContain('Trace Image');
    expect(text).toContain('Crop Image');
    expect(text).toContain('Mosaic');
  });
});

describe('Crop Image', () => {
  it('crops the asset to whole pixels and keeps the visible placement', async () => {
    const { doc, imgId } = await appWithImage();
    const node = await cropImage(doc, imgId, { x: 10, y: 5, w: 20, h: 10 });
    expect(node.asset).not.toBe('pic');
    expect(doc.assets.get(node.asset).data).toContain('20x10');
    expect(node.width).toBe(20);
    expect(node.height).toBe(10);
    // The kept part stays where it was: local (10, 5) at 2x from (50, 60).
    expect(node.transform).toEqual([2, 0, 0, 2, 70, 70]);
    const px = encoded[encoded.length - 1];
    // Pixel (0, 0) of the crop was pixel (10, 5): red; (15, 0) was (25, 5): blue.
    expect([...px.data.subarray(0, 3)]).toEqual([230, 20, 20]);
    expect(px.data[(15 * 4) + 2]).toBe(230);
    doc.undo();
    expect(doc.get(imgId).asset).toBe('pic');
    expect(doc.get(imgId).width).toBe(40);
  });

  it('lowers the resolution on request', async () => {
    const { doc, imgId } = await appWithImage();
    // 40 px over 80 pt: 36 ppi. Ask for 18 ppi.
    expect(effectivePpi(doc.get(imgId), { width: 40, height: 20 })).toBeCloseTo(36);
    const node = await cropImage(doc, imgId, { x: 0, y: 0, w: 40, h: 20 }, { ppi: 18 });
    expect(doc.assets.get(node.asset).data).toContain('20x10');
    expect(node.width).toBe(40);
  });

  it('snaps crop boxes to pixels and resizes from handles', () => {
    const node = { width: 40, height: 20 };
    expect(cropToPixels(node, { width: 80, height: 40 }, { x: 1.2, y: 0.3, w: 10.1, h: 5 }).pixels).toEqual({ x: 2, y: 0, w: 21, h: 11 });
    const r0 = { x: 10, y: 10, w: 20, h: 10 };
    expect(resizeCrop(r0, 'se', { x: 40, y: 30 })).toEqual({ x: 10, y: 10, w: 30, h: 20 });
    expect(resizeCrop(r0, 'se', { x: 50, y: 25 }, { keepRatio: true })).toEqual({ x: 10, y: 10, w: 40, h: 20 });
    expect(resizeCrop(r0, 'e', { x: 35, y: 0 }, { fromCenter: true })).toEqual({ x: 5, y: 10, w: 30, h: 10 });
  });

  it('runs as an on-canvas mode with Apply and Cancel', async () => {
    const { app, ed, doc, imgId } = await appWithImage();
    expect(app.commands.isEnabled('object.cropImage')).toBe(true);
    app.commands.run('object.cropImage');
    expect(app.toolId).toBe('crop-image');
    expect(app.cropSession.imageId).toBe(imgId);
    expect(app.cropSession.rect).toEqual(initialCropRect(ed, doc.get(imgId)));
    expect(document.querySelector('.crop-bar')).toBeTruthy();
    const tool = app.getTool('crop-image');
    tool.setRect({ x: 0, y: 0, w: 20, h: 20 });
    // Escape cancels.
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(app.toolId).not.toBe('crop-image');
    expect(doc.get(imgId).width).toBe(40);
    expect(document.querySelector('.crop-bar')).toBe(null);
    ed.select([imgId]);
    app.commands.run('object.cropImage');
    app.getTool('crop-image').setRect({ x: 0, y: 0, w: 20, h: 20 });
    await app.getTool('crop-image').applyCrop();
    expect(app.toolId).not.toBe('crop-image');
    expect(doc.get(imgId).width).toBe(20);
    expect([...ed.selection]).toEqual([imgId]);
  });
});

describe('Object Mosaic', () => {
  it('averages tile colors and lays out tiles with gaps', async () => {
    const colors = tileColors(pixels, 2, 1);
    expect(colors[0]).toMatchObject({ r: 230, g: 20, b: 20 });
    expect(colors[1]).toMatchObject({ r: 20, g: 20, b: 230 });
    expect(mosaicLayout({ cols: 4, rows: 2, width: 40, height: 20, gapX: 2, gapY: 2 })).toEqual({ tileW: 8.5, tileH: 9 });
    expect(mosaicLayout({ cols: 4, rows: 1, width: 4, height: 4, gapX: 2 })).toBe(null);
    expect(squareRows(4, 40, 20)).toBe(2);
    const { doc, imgId } = await appWithImage();
    let g;
    doc.transact('Mosaic', () => (g = buildMosaic(doc, imgId, tileColors(pixels, 4, 2), { cols: 4, rows: 2, width: 40, height: 20, gapX: 0, gapY: 0, gray: true, deleteImage: true })));
    expect(g.children).toHaveLength(8);
    expect(doc.get(imgId)).toBeUndefined();
    const first = doc.get(g.children[0]);
    expect(first.fill.color).toMatch(/^#([0-9a-f]{2})\1\1$/);
    // Tiles are in document space: the first starts at the image's corner.
    expect(first.anchors[0]).toMatchObject({ x: 50, y: 60 });
  });

  it('opens a dialog with a preview and creates the mosaic', async () => {
    const { app, ed, doc, imgId } = await appWithImage();
    const p = app.commands.run('object.mosaic');
    await flush();
    const dialog = document.querySelector('dialog.mosaic-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('.mosaic-summary').textContent).toMatch(/tiles/);
    // The preview is live in the document while the dialog is open.
    expect(doc.get(doc.get(imgId).parent).children.length).toBe(2);
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await p;
    await flush();
    const g = doc.get([...ed.selection][0]);
    expect(g.name).toBe('Mosaic');
    expect(g.children.length).toBeGreaterThan(4);
    expect(doc.undoStack.at(-1).label).toBe('Create Object Mosaic');
  });
});

describe('Make Pixel Perfect', () => {
  it('snaps anchors and stroke weights to the pixel grid', async () => {
    const { app, ed, doc } = await appWithImage();
    const odd = createPath([{ x: 10.3, y: 20.7, ix: 10.3, iy: 20.7, ox: 10.3, oy: 20.7 }, { x: 50.2, y: 20.6, ix: 50.2, iy: 20.6, ox: 50.2, oy: 20.6 }], false, { strokeWidth: 0.8, fill: null });
    const even = createPath(rectangle(5.4, 5.6, 10.2, 10.1), true, { strokeWidth: 2.2 });
    doc.transact('add', () => {
      doc.insert(odd, doc.layers()[0].id);
      doc.insert(even, doc.layers()[0].id);
    });
    ed.select([odd.id, even.id]);
    expect(app.commands.isEnabled('object.pixelPerfect')).toBe(true);
    app.commands.run('object.pixelPerfect');
    const a = doc.get(odd.id);
    expect(a.strokeWidth).toBe(1);
    expect(a.anchors.map((p) => [p.x, p.y])).toEqual([[10.5, 20.5], [50.5, 20.5]]);
    const b = doc.get(even.id);
    expect(b.strokeWidth).toBe(2);
    for (const p of b.anchors) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
    doc.undo();
    expect(doc.get(odd.id).anchors[0].x).toBe(10.3);
    // Live rectangles stay live.
    const live = createPath(rectangle(1.3, 1.3, 9.6, 9.6), true, { shape: { kind: 'rect', cx: 6.1, cy: 6.1, w: 9.6, h: 9.6 }, stroke: null });
    doc.transact('add', () => doc.insert(live, doc.layers()[0].id));
    doc.transact('pp', () => makePixelPerfect(doc, [live.id]));
    expect(doc.get(live.id).shape).toMatchObject({ w: 10, h: 10, cx: 6, cy: 6 });
  });
});

describe('Embed Image', () => {
  it('embeds linked images in one undoable step', async () => {
    const { app, ed, doc, imgId } = await appWithImage();
    doc.assets.set('linked', { mime: 'image/png', data: 'https://example.test/a.png', external: true });
    doc.transact('link', () => doc.update(imgId, { asset: 'linked' }));
    ed.select([imgId]);
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(app.commands.isEnabled('image.embed')).toBe(true);
      await app.commands.run('image.embed');
      await flush();
      const asset = doc.assets.get(doc.get(imgId).asset);
      expect(asset.external).toBeFalsy();
      expect(asset.data).toMatch(/^data:image\/png;base64,/);
      doc.undo();
      expect(doc.get(imgId).asset).toBe('linked');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
