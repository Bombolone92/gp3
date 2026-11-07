import { describe, it, expect, afterEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { visualBounds, nodeBounds } from '../src/model/geometry.js';
import { rasterEffects, contentEffects } from '../src/render/effects.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { svgRaster, svgMode } from '../src/features/pxfx/svg-export.js';
import { BUILTIN_FILTERS } from '../src/features/pxfx/svg-filters.js';
import { FILTERS, newLayer } from '../src/features/pxfx/catalog.js';
import { createEffect } from '../src/features/paint/effects-model.js';
import { effectDialog } from '../src/features/paint/effects-ui.js';
import { importSvgFilterText } from '../src/features/pxfx/svg-filter-ui.js';

// Dialog edits reach the document on the next animation frame.
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const solid = (color) => ({ type: 'solid', color });
const openDlg = () => document.querySelector('dialog[open]');
const button = (dlg, text) => [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const byLabel = (dlg, label) => dlg.querySelector(`[aria-label="${label}"]`) || dlg.querySelector(`[aria-label^="${label}"]`);

async function setup() {
  const app = await bootAppWithFeatures();
  app.newDocument();
  const doc = app.editor.doc;
  const a = createPath(rectangle(100, 100, 100, 50), true, { fill: solid('#cc3333'), stroke: null });
  const b = createPath(rectangle(300, 100, 40, 40), true, { fill: solid('#3333cc'), stroke: null });
  doc.transact('Art', () => {
    doc.insert(a, app.editor.targetLayer().id);
    doc.insert(b, app.editor.targetLayer().id);
  });
  app.editor.select([a.id]);
  return { app, doc, ed: app.editor, id: a.id, other: b.id };
}

afterEach(() => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
});

describe('pixel effect commands', () => {
  it('registers the gallery, every filter and the SVG filter commands', async () => {
    const { app, ed } = await setup();
    for (const id of ['effect.gallery', 'effect.svgFilter.apply', 'effect.svgFilter.import', ...FILTERS.map((f) => `effect.px.${f.id}`)]) {
      expect(app.commands.get(id), id).toBeTruthy();
      expect(app.commands.isEnabled(id), id).toBe(true);
    }
    expect(app.commands.label('effect.px.stainedGlass')).toBe('Stained Glass...');
    ed.select([]);
    expect(app.commands.isEnabled('effect.px.grain')).toBe(false);
    expect(app.commands.isEnabled('effect.svgFilter.import')).toBe(true);
  });

  it('makes gallery and SVG filter effects raster effects with their own reach', () => {
    const n = { type: 'path', effects: [createEffect('gallery', { stack: [newLayer('spatter', { radius: 10 })] })] };
    expect(rasterEffects(n)).toHaveLength(1);
    expect(rasterEffects({ effects: [{ ...n.effects[0], hidden: true }] })).toBeNull();
    expect(contentEffects.has('gallery')).toBe(true);
    expect(contentEffects.has('svgFilter')).toBe(true);
  });
});

describe('Effect Gallery', () => {
  it('opens on a filter, previews live and commits one undo step', async () => {
    const { app, doc, id } = await setup();
    const undo0 = doc.undoStack.length;
    const done = app.commands.run('effect.px.crystallize');
    await tick();
    const dlg = openDlg();
    expect(dlg.querySelector('.dialog-title').textContent).toBe('Effect Gallery');
    expect(dlg.querySelector('.pxg-tile[data-filter="crystallize"]').getAttribute('aria-pressed')).toBe('true');
    expect(dlg.querySelector('.pxg-cat[data-cat="pixelate"]').open).toBe(true);
    await tick();
    expect(doc.get(id).effects).toEqual([expect.objectContaining({ type: 'gallery', stack: [{ filter: 'crystallize', size: 10 }] })]);
    // Change the cell size with its field.
    const field = [...dlg.querySelectorAll('.pxg-params .fx-num')][0];
    field.value = '24';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(doc.get(id).effects[0].stack[0].size).toBe(24);
    button(dlg, 'OK').click();
    expect(await done).toBe(true);
    expect(doc.tx).toBeNull();
    expect(doc.undoStack.length).toBe(undo0 + 1);
    expect(app.lastEffect).toMatchObject({ type: 'gallery' });
    doc.undo();
    expect(doc.get(id).effects || []).toEqual([]);
  });

  it('Cancel leaves the object as it was', async () => {
    const { app, doc, id } = await setup();
    const before = doc.get(id);
    const undo0 = doc.undoStack.length;
    const done = app.commands.run('effect.px.grain');
    await tick();
    await tick();
    expect(doc.get(id).effects).toHaveLength(1);
    button(openDlg(), 'Cancel').click();
    expect(await done).toBe(false);
    expect(doc.get(id)).toBe(before);
    expect(doc.undoStack.length).toBe(undo0);
  });

  it('stacks filters: add, pick, reorder, hide and delete', async () => {
    const { app, doc, id } = await setup();
    const done = app.commands.run('effect.px.grain');
    await tick();
    const dlg = openDlg();
    byLabel(dlg, 'New filter layer').click();
    dlg.querySelector('.pxg-tile[data-filter="mosaicTiles"]').click();
    await tick();
    const names = () => [...dlg.querySelectorAll('.pxg-layer .pxg-layer-name')].map((n) => n.textContent);
    expect(names()).toEqual(['Grain', 'Mosaic Tiles']);
    expect(doc.get(id).effects[0].stack.map((l) => l.filter)).toEqual(['grain', 'mosaicTiles']);
    // Move Mosaic Tiles first, then hide it.
    byLabel(dlg, 'Move up').click();
    await tick();
    expect(names()).toEqual(['Mosaic Tiles', 'Grain']);
    dlg.querySelector('.pxg-layer .pxg-eye').click();
    await tick();
    expect(doc.get(id).effects[0].stack[0]).toMatchObject({ filter: 'mosaicTiles', hidden: true });
    // Keyboard: select Grain and delete it.
    const list = dlg.querySelector('.pxg-stack');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await tick();
    expect(names()).toEqual(['Mosaic Tiles']);
    // The filter menu switches the selected layer's filter.
    const sel = dlg.querySelector('.pxg-filter');
    sel.value = 'chrome';
    sel.dispatchEvent(new Event('change'));
    await tick();
    expect(doc.get(id).effects[0].stack).toEqual([expect.objectContaining({ filter: 'chrome', hidden: true })]);
    button(dlg, 'OK').click();
    await done;
    expect(doc.get(id).effects[0].stack.map((l) => l.filter)).toEqual(['chrome']);
  });

  it('finds filters by name', async () => {
    const { app } = await setup();
    const done = app.commands.run('effect.gallery');
    await tick();
    const dlg = openDlg();
    const search = dlg.querySelector('.pxg-search');
    search.value = 'glass';
    search.dispatchEvent(new Event('input'));
    const shown = [...dlg.querySelectorAll('.pxg-tile')].filter((t) => !t.hidden && !t.closest('details').hidden).map((t) => t.dataset.filter);
    expect(shown.sort()).toEqual(['glass', 'stainedGlass']);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(dlg.querySelector('.pxg-filter').value).toBe('glass');
    button(dlg, 'Cancel').click();
    await done;
  });

  it('is edited from the Appearance panel and repeated by Apply Last Effect / Last Effect', async () => {
    const { app, doc, id, other, ed } = await setup();
    let done = app.commands.run('effect.px.stamp');
    await tick();
    button(openDlg(), 'OK').click();
    await done;
    const applied = doc.get(id).effects[0];
    expect(app.commands.label('effect.applyLast')).toBe('Apply Stamp');
    // Edit in place from the Appearance row.
    done = effectDialog(app, 'gallery', { edit: { id, index: 0 } });
    await tick();
    const dlg = openDlg();
    expect(dlg.querySelector('.pxg-filter').value).toBe('stamp');
    dlg.querySelector('.pxg-tile[data-filter="photocopy"]').click();
    button(dlg, 'OK').click();
    await done;
    expect(doc.get(id).effects).toHaveLength(1);
    expect(doc.get(id).effects[0]).toMatchObject({ seed: applied.seed, stack: [expect.objectContaining({ filter: 'photocopy' })] });
    // Apply the last effect to another object.
    ed.select([other]);
    app.commands.run('effect.applyLast');
    expect(doc.get(other).effects).toEqual([expect.objectContaining({ type: 'gallery', stack: [expect.objectContaining({ filter: 'photocopy' })] })]);
    // Last Effect opens the gallery with those settings.
    done = app.commands.run('effect.last');
    await tick();
    expect(openDlg().querySelector('.pxg-filter').value).toBe('photocopy');
    button(openDlg(), 'Cancel').click();
    await done;
  });

  it('removes the edited effect when its stack is emptied', async () => {
    const { app, doc, id } = await setup();
    doc.transact('fx', () => doc.update(id, { effects: [createEffect('gallery', { stack: [newLayer('grain')] }), createEffect('blur', { radius: 2 })] }));
    const done = effectDialog(app, 'gallery', { edit: { id, index: 0 } });
    await tick();
    const dlg = openDlg();
    byLabel(dlg, 'Delete filter layer').click();
    await tick();
    expect(dlg.querySelector('.pxg-empty')).toBeTruthy();
    button(dlg, 'OK').click();
    await done;
    expect(doc.get(id).effects.map((e) => e.type)).toEqual(['blur']);
  });

  it('grows the visual bounds by what the filters paint outside', async () => {
    const { doc, id } = await setup();
    const vb0 = visualBounds(doc, doc.get(id));
    doc.transact('fx', () => doc.update(id, { effects: [createEffect('gallery', { stack: [newLayer('spatter', { radius: 12 })] })] }));
    const vb = visualBounds(doc, doc.get(id));
    expect(vb.x).toBeCloseTo(vb0.x - 6, 6);
    expect(vb.w).toBeCloseTo(vb0.w + 12, 6);
    expect(nodeBounds(doc, doc.get(id))).toEqual(nodeBounds(doc, { ...doc.get(id), effects: [] }));
  });
});

describe('SVG filters', () => {
  it('applies a built-in filter with preview and writes it as a real <filter>', async () => {
    const { app, doc, id } = await setup();
    const done = app.commands.run('effect.svgFilter.apply');
    await tick();
    const dlg = openDlg();
    expect(dlg.querySelector('.dialog-title').textContent).toBe('Apply SVG Filter');
    expect(dlg.querySelectorAll('.pxf-item').length).toBe(BUILTIN_FILTERS.length);
    [...dlg.querySelectorAll('.pxf-item')].find((li) => li.textContent === 'Warm Glow').click();
    await tick();
    expect(doc.get(id).effects[0]).toMatchObject({ type: 'svgFilter', name: 'Warm Glow' });
    expect(dlg.querySelector('.pxf-code').value).toContain('feMorphology');
    // Arrow keys move through the list.
    dlg.querySelector('.pxf-list').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick();
    expect(doc.get(id).effects[0].name).toBe('Neon Edge');
    button(dlg, 'OK').click();
    expect(await done).toBe(true);
    const n = doc.get(id);
    expect(svgMode(n)).toBe('filter');
    // Glows reach past the object.
    expect(visualBounds(doc, n).w).toBeGreaterThan(nodeBounds(doc, n).w);
    doc.transact('opacity', () => doc.update(id, { opacity: 0.5 }));
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
    const fid = svg.match(/<g filter="url\(#(\w+)\)" opacity="0.5">/)?.[1];
    expect(fid).toBeTruthy();
    expect(svg).toContain(`<filter id="${fid}"`);
    expect(svg).toMatch(/<feMorphology[^>]*operator="dilate"/);
    // The object inside the filter group has no opacity of its own.
    const inner = svg.slice(svg.indexOf(`url(#${fid})`));
    expect(inner.match(/<path[^>]*>/)[0]).not.toContain('opacity');
  });

  it('turns edited code into a custom filter and ignores code that does not parse', async () => {
    const { app, doc, id } = await setup();
    const done = app.commands.run('effect.svgFilter.apply');
    await tick();
    const dlg = openDlg();
    const code = dlg.querySelector('.pxf-code');
    code.value = '<filter><broken';
    code.dispatchEvent(new Event('input'));
    expect(code.getAttribute('aria-invalid')).toBe('true');
    code.value = '<filter xmlns="http://www.w3.org/2000/svg"><feOffset dx="3" dy="3"/></filter>';
    code.dispatchEvent(new Event('input'));
    await tick();
    expect(code.hasAttribute('aria-invalid')).toBe(false);
    expect([...dlg.querySelectorAll('.pxf-item')].at(-1).textContent).toBe('Custom');
    button(dlg, 'OK').click();
    await done;
    expect(doc.get(id).effects[0]).toMatchObject({ type: 'svgFilter', name: 'Custom' });
    expect(doc.get(id).effects[0].markup).toContain('feOffset');
  });

  it('imports filters from SVG text into the document and offers them', async () => {
    const { app, doc, id } = await setup();
    const text = '<svg xmlns="http://www.w3.org/2000/svg"><filter id="wobble"><feTurbulence baseFrequency="0.05"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter></svg>';
    expect(importSvgFilterText(app, text)).toBe(true);
    expect(doc.root.svgFilters.map((f) => f.name)).toEqual(['wobble']);
    await tick();
    const dlg = openDlg();
    const selected = dlg.querySelector('.pxf-item[aria-selected="true"]');
    expect(selected.textContent).toBe('wobble');
    expect([...dlg.querySelectorAll('.pxf-group')].map((g) => g.textContent)).toEqual(['Built-in', 'In this document']);
    button(dlg, 'OK').click();
    await tick();
    expect(doc.get(id).effects[0]).toMatchObject({ type: 'svgFilter', name: 'wobble' });
    expect(importSvgFilterText(app, text)).toBe(false);
    doc.undo();
    doc.undo();
    expect(doc.root.svgFilters || []).toEqual([]);
  });
});

describe('export', () => {
  it('embeds gallery effects in SVG as an image of the effected object at its visual bounds', async () => {
    const { doc, id } = await setup();
    doc.transact('fx', () => doc.update(id, { opacity: 0.8, effects: [createEffect('gallery', { stack: [newLayer('spatter', { radius: 10 })] })] }));
    const calls = [];
    const prev = svgRaster.render;
    svgRaster.render = (d, node, rect, k) => {
      calls.push({ node, rect, k });
      return 'data:image/png;base64,QUJD';
    };
    try {
      const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
      expect(calls).toHaveLength(1);
      expect(calls[0].rect).toEqual(visualBounds(doc, doc.get(id)));
      expect(calls[0].k).toBe(1);
      // Opacity applies to the image, not inside the render.
      expect(calls[0].node.opacity).toBe(1);
      expect(svg).toMatch(/<image x="95" y="95" width="110" height="60" preserveAspectRatio="none" xlink:href="data:image\/png;base64,QUJD" opacity="0.8"\/>/);
      expect(svg).toContain('xmlns:xlink');
      // Only the other rectangle is still a vector path.
      expect(svg.match(/<path/g)).toHaveLength(1);
      // Crops to the export area.
      calls.length = 0;
      exportSVG(doc, { rect: { x: 150, y: 0, w: 250, h: 300 } });
      expect(calls[0].rect.x).toBeCloseTo(149, 6);
      // A hidden gallery effect exports the object as usual.
      doc.transact('hide', () => doc.update(id, { effects: [{ ...doc.get(id).effects[0], hidden: true }] }));
      calls.length = 0;
      expect(exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } }).match(/<path/g)).toHaveLength(2);
      expect(calls).toHaveLength(0);
    } finally {
      svgRaster.render = prev;
    }
  });

  it('embeds at the document raster effects resolution and keeps the effect order with SVG filters', async () => {
    const { doc, id } = await setup();
    const f = BUILTIN_FILTERS[0];
    doc.transact('fx', () => {
      doc.updateRoot({ rasterResolution: 150 });
      doc.update(id, { effects: [createEffect('svgFilter', { name: f.name, markup: f.markup }), createEffect('blur', { radius: 2 })] });
    });
    // A blur after an SVG filter cannot be expressed in order: the object becomes an image.
    expect(svgMode(doc.get(id))).toBe('raster');
    doc.transact('fx', () => doc.update(id, { effects: [createEffect('blur', { radius: 2 }), createEffect('svgFilter', { name: f.name, markup: f.markup })] }));
    expect(svgMode(doc.get(id))).toBe('filter');
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
    // The blur is the object's own filter, inside the SVG filter group.
    expect(svg).toMatch(/<g filter="url\(#f\d+\)">\s*<path[^>]*filter="url\(#f\d+\)"/);
    const prev = svgRaster.render;
    let k = 0;
    svgRaster.render = (d, n, r, kk) => {
      k = kk;
      return 'data:image/png;base64,QQ==';
    };
    doc.transact('fx', () => doc.update(id, { effects: [createEffect('gallery', { stack: [newLayer('grain')] })] }));
    exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
    svgRaster.render = prev;
    expect(k).toBeCloseTo(150 / 72, 6);
  });

  it('rasterizes the effects in PDF output', async () => {
    const { doc, id } = await setup();
    doc.transact('fx', () => doc.update(id, { effects: [createEffect('gallery', { stack: [newLayer('grain')] })] }));
    const { writePDF } = await import('../src/features/io/pdf.js');
    const { warnings } = await writePDF(doc, [{ x: 0, y: 0, w: 400, h: 300 }], {});
    // The test canvas cannot render pixels: the writer reports it instead of silently dropping the effect.
    expect(warnings.join(' ')).toMatch(/could not be included/);
  });
});
