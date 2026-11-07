import { describe, it, expect, vi } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createPath, createGroup } from '../src/model/nodes.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { anchor } from '../src/model/bezier.js';
import { drawNode } from '../src/render/draw.js';
import { drawOverlay } from '../src/render/overlay.js';
import { selectionKind, PropertiesPanel } from '../src/ui/panels/properties.js';
import { MENUS } from '../src/ui/menus.js';
import { VDocument } from '../src/model/document.js';
import { liveArtwork } from '../src/model/live.js';
import { nodeBounds } from '../src/model/geometry.js';

const solid = (c) => ({ type: 'solid', color: c });

/** Every command id named anywhere in a menu tree. */
function menuIds(items, out = new Set()) {
  for (const it of items || []) {
    if (typeof it === 'string') out.add(it);
    else if (it?.id) out.add(it.id);
    if (it?.submenu) menuIds(it.submenu, out);
  }
  return out;
}

describe('repeat track smoke test', () => {
  it('draws every live kind, refreshes panels and overlays without errors', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const ed = app.editor;
    const doc = ed.doc;
    const errors = vi.spyOn(console, 'error');
    const warns = vi.spyOn(console, 'warn');
    const add = (n) => (doc.transact('add', () => doc.insert(n, doc.layers()[0].id)), n.id);
    const run = async (cmd, ids) => {
      ed.select(ids);
      await app.commands.run(cmd);
      return ed.topSelection()[0];
    };
    const kinds = [];
    kinds.push(await run('repeat.radial', [add(createPath(rectangle(50, 50, 20, 30), true, { fill: solid('#f00') }))]));
    kinds.push(await run('repeat.grid', [add(createPath(ellipse(300, 50, 20, 20), true, { fill: solid('#0f0') }))]));
    kinds.push(await run('paintRegions.make', [add(createPath(rectangle(50, 300, 50, 50), true, { fill: solid('#00f') })), add(createPath(rectangle(75, 325, 50, 50), true, { fill: solid('#ff0') }))]));
    kinds.push(await run('interlace.make', [add(createPath(ellipse(300, 300, 60, 60), true, { fill: null, stroke: solid('#000'), strokeWidth: 8 })), add(createPath(ellipse(340, 300, 60, 60), true, { fill: null, stroke: solid('#f0f'), strokeWidth: 8 }))]));
    app.setTool('selection');
    const path = add(createPath([anchor(500, 500), anchor(700, 520)], false, { fill: null, stroke: solid('#000') }));
    const dots = [add(createPath(ellipse(0, 600, 10, 10), true, { fill: solid('#000') })), add(createPath(ellipse(20, 600, 10, 10), true, { fill: solid('#000') }))];
    ed.select([path, ...dots]);
    const attach = app.commands.run('objectsOnPath.attach');
    await new Promise((r) => setTimeout(r, 0));
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Attach').click();
    await attach;
    kinds.push(ed.topSelection()[0]);
    // A mirror ends in isolation; leave it.
    const mirrorSrc = add(createPath(rectangle(600, 50, 20, 30), true, { fill: solid('#0ff') }));
    ed.select([mirrorSrc]);
    await app.commands.run('repeat.mirror');
    kinds.push(ed.isolation);
    await app.commands.run('object.exitIsolation');
    const labels = kinds.map((id) => selectionKind({ selectedNodes: () => [doc.get(id)] }));
    expect(labels).toEqual(['Radial Repeat', 'Grid Repeat', 'Paint Regions', 'Interlace', 'Objects on Path', 'Mirror Repeat']);
    // Render the whole document (stub context) and the overlay for each selected kind.
    const ctx = document.createElement('canvas').getContext('2d');
    for (const id of doc.root.children) drawNode(ctx, doc, doc.get(id), { scale: 1, hairline: 1 });
    drawNode(ctx, doc, doc.get(doc.root.children[0]), { scale: 1, hairline: 1, outline: true });
    const panel = app.panels?.get?.('properties') || null;
    for (const id of kinds) {
      ed.select([id]);
      drawOverlay(ctx, ed, { selection: '#4f80ff' });
      for (const sec of PropertiesPanel.extraSections) {
        if (!sec.when(ed)) continue;
        const inst = sec.build(app);
        inst.refresh();
      }
      panel?.update?.();
    }
    for (const tool of ['paint-bucket', 'region-select']) {
      app.setTool(tool);
      expect(app.toolId).toBe(tool);
      app.tool.onHover({ x: 60, y: 310, sx: 60, sy: 310, shift: false, alt: false });
      drawOverlay(ctx, ed, { selection: '#4f80ff' });
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warns.mock.calls.filter((c) => String(c[0]).startsWith('Live'))).toEqual([]);
    // Every new command is in a menu, and the tools are in the Tools panel.
    const ids = menuIds(MENUS);
    for (const id of ['repeat.radial', 'repeat.grid', 'repeat.mirror', 'repeat.release', 'repeat.options', 'objectsOnPath.attach', 'objectsOnPath.options', 'objectsOnPath.release', 'objectsOnPath.expand', 'blend.replaceSpine', 'blend.reverseSpine', 'blend.reverseFrontToBack', 'paintRegions.make', 'paintRegions.merge', 'paintRegions.release', 'paintRegions.gapOptions', 'paintRegions.expand', 'view.paintRegionGaps', 'interlace.make', 'interlace.release', 'interlace.edit']) {
      expect(ids.has(id), id).toBe(true);
      expect(app.commands.get(id), id).toBeTruthy();
    }
    expect(document.querySelector('[data-tool="paint-bucket"], [data-tool-id="paint-bucket"]') || app.toolClasses.has('paint-bucket')).toBeTruthy();
  });

  it('repeats of paint regions and of interlace groups render their copies', () => {
    const doc = VDocument.create({ width: 400, height: 400 });
    const layer = doc.layers()[0].id;
    const a = createPath(rectangle(0, 0, 20, 20), true, { fill: solid('#f00') });
    const g = createGroup([a.id], { live: { kind: 'paintRegions', faces: [{ fill: solid('#0f0'), pts: [[10, 10]] }], edges: [] } });
    const r = createGroup([g.id], { live: { kind: 'repeat', mode: 'grid', cols: 3, rows: 1, hSpacing: 10, vSpacing: 0, gridType: 'grid', frame: [1, 0, 0, 1] } });
    doc.transact('add', () => doc.insert(r, layer, Infinity, [g, a]));
    doc.repairParents();
    expect(nodeBounds(doc, doc.get(r.id)).w).toBeCloseTo(80);
    const items = liveArtwork(doc, doc.get(r.id)).items;
    expect(items).toHaveLength(3);
  });
});
