import { describe, it, expect, beforeEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createPath, createText } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { nodeBounds } from '../src/model/geometry.js';
import { resolveItems } from '../src/ui/menubar.js';
import { MENUS } from '../src/ui/menus.js';
import { gridOf, isPerspective, frameFor } from '../src/features/perspective/model.js';
import { pstate, setPState } from '../src/features/perspective/state.js';
import { gridHandles } from '../src/features/perspective/handles.js';
import { toDoc } from '../src/features/perspective/grid-math.js';
import { userPresets } from '../src/features/perspective/presets.js';
import { setOutlineLoader } from '../src/features/perspective/project.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}

function drag(app, from, to, mods = {}, steps = 4) {
  const t = app.tool;
  t.onPointerDown(ev(app, from.x, from.y, mods));
  for (let i = 1; i <= steps; i++) t.onPointerMove(ev(app, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, mods));
  t.onPointerUp(ev(app, to.x, to.y, mods));
}

/** A key press as the app hands it to the active tool (every booted app listens on the document). */
function key(app, k, extra = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  return app.tool.onKeyDown(e);
}

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const find = (items, label) => items.find((i) => i.label === label);

let app;
beforeEach(async () => {
  app = await bootAppWithFeatures();
  // Font files do not load in tests: type in perspective uses its affine stand-in.
  setOutlineLoader(null);
  app.newDocument();
  app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 900 });
  app.editor.setViewOption('snapToPoint', false);
  app.editor.setViewOption('alignmentGuides', false);
});

describe('perspective commands and widget', () => {
  it('fills View > Perspective Grid and Object > Perspective', () => {
    const view = resolveItems(app, MENUS.find((m) => m.label === 'View').submenu);
    const sub = find(view, 'Perspective Grid').items;
    expect(sub.map((i) => i.label)).toEqual(expect.arrayContaining(['Show Grid', 'Show Rulers', 'Snap to Grid', 'Lock Grid', 'Lock Station Point', 'Define Grid...', 'One Point Perspective', 'Two Point Perspective', 'Three Point Perspective', 'Grid Presets', 'Save Grid as Preset...']));
    expect(find(sub, 'Two Point Perspective').checked).toBe(true);
    expect(find(sub, 'Show Grid').shortcut).toBeTruthy();
    const edit = resolveItems(app, MENUS.find((m) => m.label === 'Edit').submenu);
    expect(find(edit, 'Perspective Grid Presets...')).toBeTruthy();
    const obj = resolveItems(app, MENUS.find((m) => m.label === 'Object').submenu);
    expect(find(obj, 'Perspective').items.map((i) => i.label)).toEqual(['Attach to Active Plane', 'Release with Perspective', 'Move Plane to Match Object', 'Edit Text']);
    const presets = find(sub, 'Grid Presets').items;
    expect(presets.length).toBeGreaterThanOrEqual(3);
  });

  it('shows and hides the grid with its widget', async () => {
    const widget = document.querySelector('.persp-widget');
    expect(widget).toBeTruthy();
    expect(widget.hidden).toBe(true);
    await app.commands.run('perspective.show');
    expect(pstate(app.editor).visible).toBe(true);
    expect(widget.hidden).toBe(false);
    expect(app.commands.label('perspective.show')).toBe('Hide Grid');
    expect(widget.getAttribute('role')).toBe('radiogroup');
    const left = widget.querySelector('[data-plane="left"]');
    expect(left.getAttribute('aria-checked')).toBe('true');
    // Clicking a face activates its plane; arrow keys move between planes.
    widget.querySelector('[data-plane="right"]').dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(pstate(app.editor).plane).toBe('right');
    widget.querySelector('[data-plane="right"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(pstate(app.editor).plane).toBe('none');
    await app.commands.run('perspective.show');
    expect(widget.hidden).toBe(true);
  });

  it('switches grid types from the menu, with undo', async () => {
    await app.commands.run('perspective.three');
    const doc = app.editor.doc;
    expect(gridOf(doc).type).toBe('three');
    expect(app.commands.isChecked('perspective.three')).toBe(true);
    expect(pstate(app.editor).visible).toBe(true);
    doc.undo();
    expect(gridOf(doc).type).toBe('two');
    await app.commands.run('perspective.one');
    expect(gridOf(doc).type).toBe('one');
    expect(app.commands.isEnabled('perspective.lockStation')).toBe(false);
  });

  it('toggles snapping, rulers and locks', async () => {
    const st = () => pstate(app.editor);
    expect(st().snap).toBe(true);
    await app.commands.run('perspective.snap');
    expect(st().snap).toBe(false);
    await app.commands.run('perspective.rulers');
    expect(st().rulers).toBe(true);
    await app.commands.run('perspective.lock');
    expect(app.commands.isChecked('perspective.lock')).toBe(true);
    await app.commands.run('perspective.lockStation');
    expect(st().lockStation).toBe(true);
  });
});

describe('drawing in perspective', () => {
  it('draws rectangles straight onto the active plane, one undo step', () => {
    const ed = app.editor;
    const doc = ed.doc;
    setPState(ed, { visible: true, plane: 'right', snap: false });
    const g = gridOf(doc);
    app.setTool('rectangle');
    drag(app, { x: g.ox + 40, y: g.oy - 150 }, { x: g.ox + 140, y: g.oy - 60 });
    const [sel] = ed.topSelection();
    const node = doc.get(sel);
    expect(isPerspective(node)).toBe(true);
    expect(node.live.plane).toBe('right');
    const rect = doc.get(node.children[0]);
    expect(rect.shape.kind).toBe('rect');
    // The flat rectangle's corners project to where the drag started and ended.
    const f = frameFor(g, 'right', 0);
    const b = nodeBounds(doc, rect);
    const tl = toDoc(f, b.x, b.y);
    expect(tl.x).toBeCloseTo(g.ox + 40, 4);
    expect(tl.y).toBeCloseTo(g.oy - 150, 4);
    const br = toDoc(f, b.x + b.w, b.y + b.h);
    expect(br.x).toBeCloseTo(g.ox + 140, 4);
    expect(br.y).toBeCloseTo(g.oy - 60, 4);
    expect(doc.undoLabel).toBe('Rectangle');
    doc.undo();
    expect(doc.get(sel)).toBeUndefined();
  });

  it('snaps drawing to the grid cells', () => {
    const ed = app.editor;
    const doc = ed.doc;
    setPState(ed, { visible: true, plane: 'floor', snap: true });
    const g = gridOf(doc);
    const f = frameFor(g, 'floor', 0);
    const a = toDoc(f, g.ox + 2 * g.cell + 1, g.oy - 3 * g.cell + 1);
    const b = toDoc(f, g.ox + 5 * g.cell - 1, g.oy - g.cell - 1);
    app.setTool('ellipse');
    drag(app, a, b);
    const node = doc.get(ed.topSelection()[0]);
    const bb = nodeBounds(doc, doc.get(node.children[0]));
    expect((bb.x - g.ox) / g.cell).toBeCloseTo(2, 6);
    expect((bb.x + bb.w - g.ox) / g.cell).toBeCloseTo(5, 6);
  });

  it('draws ordinary shapes when the grid is hidden or no plane is active', () => {
    const ed = app.editor;
    setPState(ed, { visible: true, plane: 'none' });
    app.setTool('rectangle');
    drag(app, { x: 100, y: 100 }, { x: 200, y: 160 });
    expect(isPerspective(ed.doc.get(ed.topSelection()[0]))).toBe(false);
  });
});

describe('Perspective Selection tool', () => {
  function perspectiveRect(plane = 'right') {
    const ed = app.editor;
    setPState(ed, { visible: true, plane, snap: false });
    const g = gridOf(ed.doc);
    app.setTool('rectangle');
    const x0 = plane === 'left' ? g.ox - 140 : g.ox + 40;
    drag(app, { x: x0, y: g.oy - 150 }, { x: x0 + 100, y: g.oy - 60 });
    return ed.topSelection()[0];
  }

  it('moves objects within their plane and follows the pointer', () => {
    const id = perspectiveRect();
    const ed = app.editor;
    const doc = ed.doc;
    const child = doc.get(id).children[0];
    const flat0 = nodeBounds(doc, doc.get(child));
    app.setTool('perspective-select');
    const f = frameFor(gridOf(doc), 'right', 0);
    // Press on the object's flat center and release over the point 50 units further along the plane.
    const flatC = { x: flat0.x + flat0.w / 2, y: flat0.y + flat0.h / 2 };
    drag(app, toDoc(f, flatC.x, flatC.y), toDoc(f, flatC.x + 50, flatC.y));
    const flat1 = nodeBounds(doc, doc.get(child));
    expect(flat1.w).toBeCloseTo(flat0.w, 6);
    expect(flat1.x - flat0.x).toBeCloseTo(50, 6);
    expect(flat1.y - flat0.y).toBeCloseTo(0, 6);
    expect(doc.undoLabel).toBe('Move');
    doc.undo();
    expect(nodeBounds(doc, doc.get(child))).toEqual(flat0);
  });

  it('duplicates with Alt-drag and moves perpendicular to the plane with 5', () => {
    const id = perspectiveRect();
    const ed = app.editor;
    const doc = ed.doc;
    app.setTool('perspective-select');
    const c = center(nodeBounds(doc, doc.get(id)));
    drag(app, c, { x: c.x + 30, y: c.y }, { alt: true });
    const copies = ed.topSelection();
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe(id);
    expect(isPerspective(doc.get(copies[0]))).toBe(true);
    expect(doc.undoLabel).toBe('Duplicate');
    // Hold 5: the drag changes the plane position instead.
    const c2 = center(nodeBounds(doc, doc.get(copies[0])));
    const t = app.tool;
    t.onPointerDown(ev(app, c2.x, c2.y));
    key(app, '5');
    for (let i = 1; i <= 4; i++) t.onPointerMove(ev(app, c2.x - 10 * i, c2.y + 3 * i));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: '5' }));
    t.onPointerUp(ev(app, c2.x - 40, c2.y + 12));
    expect(doc.get(copies[0]).live.offset).not.toBe(0);
    doc.undo();
    expect(doc.get(copies[0]).live.offset).toBe(0);
  });

  it('nudges along the plane with the arrow keys and picks planes with 1-4', () => {
    const id = perspectiveRect('left');
    const ed = app.editor;
    const doc = ed.doc;
    app.setTool('perspective-select');
    const child = doc.get(id).children[0];
    const flat0 = nodeBounds(doc, doc.get(child));
    expect(key(app, 'ArrowRight', { shiftKey: true })).toBe(true);
    const flat1 = nodeBounds(doc, doc.get(child));
    expect(flat1.x - flat0.x).toBeCloseTo(10, 9);
    key(app, '3');
    expect(pstate(ed).plane).toBe('right');
    key(app, '2');
    expect(pstate(ed).plane).toBe('floor');
    key(app, '4');
    expect(pstate(ed).plane).toBe('none');
  });

  it('brings ordinary artwork onto the active plane when dragged', () => {
    const ed = app.editor;
    const doc = ed.doc;
    const g = gridOf(doc);
    const r = createPath(rectangle(g.ox + 60, g.oy - 140, 60, 60), true);
    doc.transact('add', () => doc.insert(r, ed.targetLayer().id));
    setPState(ed, { visible: true, plane: 'right' });
    app.setTool('perspective-select');
    drag(app, { x: g.ox + 90, y: g.oy - 110 }, { x: g.ox + 100, y: g.oy - 110 });
    const [sel] = ed.topSelection();
    expect(isPerspective(doc.get(sel))).toBe(true);
    expect(doc.get(sel).children).toEqual([r.id]);
  });

  it('scales through the perspective box', () => {
    const id = perspectiveRect();
    const ed = app.editor;
    const doc = ed.doc;
    app.setTool('perspective-select');
    ed.select([id]);
    const child = doc.get(id).children[0];
    const flat0 = nodeBounds(doc, doc.get(child));
    const f = frameFor(gridOf(doc), 'right', 0);
    const se = toDoc(f, flat0.x + flat0.w, flat0.y + flat0.h);
    const target = toDoc(f, flat0.x + flat0.w * 2, flat0.y + flat0.h);
    drag(app, se, target);
    const flat1 = nodeBounds(doc, doc.get(child));
    expect(flat1.w).toBeCloseTo(flat0.w * 2, 1);
    expect(flat1.x).toBeCloseTo(flat0.x, 4);
    expect(doc.undoLabel).toBe('Scale');
  });
});

describe('Perspective Grid tool', () => {
  it('drags a vanishing point in one undo step, unless the grid is locked', () => {
    const ed = app.editor;
    const doc = ed.doc;
    app.setTool('perspective-grid');
    expect(pstate(ed).visible).toBe(true);
    const g0 = gridOf(doc);
    const vr = gridHandles(g0).find((h) => h.id === 'vr');
    ed.view.set({ zoom: 0.5, panX: 300, panY: 100 });
    drag(app, vr, { x: vr.x + 80, y: vr.y });
    expect(gridOf(doc).vr).toBeCloseTo(g0.vr + 80, 6);
    expect(doc.undoLabel).toBe('Edit Perspective Grid');
    doc.undo();
    expect(gridOf(doc).vr).toBeCloseTo(g0.vr, 6);
    setPState(ed, { lock: true });
    let note = '';
    app.notify = (m) => (note = m);
    drag(app, vr, { x: vr.x + 80, y: vr.y });
    expect(gridOf(doc).vr).toBeCloseTo(g0.vr, 6);
    expect(note).toMatch(/locked/);
  });

  it('moves objects with their plane on Shift-drag', () => {
    const ed = app.editor;
    const doc = ed.doc;
    setPState(ed, { visible: true, plane: 'right', snap: false });
    const g = gridOf(doc);
    app.setTool('rectangle');
    drag(app, { x: g.ox + 40, y: g.oy - 150 }, { x: g.ox + 140, y: g.oy - 60 });
    const id = ed.topSelection()[0];
    app.setTool('perspective-grid');
    const h = gridHandles(gridOf(doc)).find((x) => x.id === 'plane-right');
    // Drag the right plane control toward the left vanishing point.
    drag(app, h, { x: h.x - 40, y: h.y - 8 }, { shift: true });
    const off = gridOf(doc).planes.right;
    expect(off).not.toBe(0);
    expect(doc.get(id).live.offset).toBeCloseTo(off, 9);
    expect(doc.undoLabel).toBe('Move Plane and Objects');
  });

  it('hides the grid with Escape', () => {
    app.setTool('perspective-grid');
    expect(key(app, 'Escape')).toBe(true);
    expect(pstate(app.editor).visible).toBe(false);
  });
});

describe('perspective object commands and dialogs', () => {
  it('attaches, matches the plane and releases', async () => {
    const ed = app.editor;
    const doc = ed.doc;
    const g = gridOf(doc);
    const r = createPath(rectangle(g.ox - 120, g.oy - 140, 60, 60), true);
    doc.transact('add', () => doc.insert(r, ed.targetLayer().id));
    ed.select([r.id]);
    expect(app.commands.isEnabled('perspective.attach')).toBe(false);
    setPState(ed, { visible: true, plane: 'left' });
    await app.commands.run('perspective.attach');
    const [id] = ed.topSelection();
    expect(isPerspective(doc.get(id))).toBe(true);
    doc.transact('offset', () => doc.update(id, { live: { ...doc.get(id).live, offset: 30 } }));
    setPState(ed, { plane: 'none' });
    await app.commands.run('perspective.movePlane');
    expect(gridOf(doc).planes.left).toBe(30);
    expect(pstate(ed).plane).toBe('left');
    await app.commands.run('perspective.release');
    const [out] = ed.topSelection();
    expect(out).toBe(doc.get(out).id);
    expect(doc.get(out).type).toBe('path');
    expect(isPerspective(doc.get(doc.get(out).parent))).toBe(false);
  });

  it('edits perspective type in a dialog with live preview', async () => {
    const ed = app.editor;
    const doc = ed.doc;
    const g = gridOf(doc);
    const t = createText('Sign', g.ox + 40, g.oy - 80);
    doc.transact('add', () => doc.insert(t, ed.targetLayer().id));
    ed.select([t.id]);
    setPState(ed, { visible: true, plane: 'right' });
    await app.commands.run('perspective.attach');
    expect(app.commands.isEnabled('perspective.editText')).toBe(true);
    app.dialogs.open = async ({ body }) => {
      const area = body.querySelector('textarea');
      area.value = 'Signpost';
      area.dispatchEvent(new Event('input'));
      return true;
    };
    await app.commands.run('perspective.editText');
    expect(doc.get(t.id).text).toBe('Signpost');
    expect(doc.undoLabel).toBe('Edit Text');
  });

  it('defines the grid with a live preview and Cancel restores it', async () => {
    const ed = app.editor;
    const doc = ed.doc;
    const before = gridOf(doc);
    let preview = null;
    app.dialogs.open = async ({ body }) => {
      const field = [...body.querySelectorAll('.form-row')].find((r) => r.textContent.startsWith('Horizon height')).querySelector('input');
      field.value = '120';
      field.dispatchEvent(new Event('change'));
      preview = gridOf(doc);
      return false;
    };
    await app.commands.run('perspective.define');
    expect(preview.oy - preview.horizon).toBeCloseTo(120, 6);
    expect(gridOf(doc)).toBe(before);
    expect(pstate(ed).visible).toBe(false);
    app.dialogs.open = async ({ body }) => {
      const type = body.querySelector('select:not([id=""])');
      const typeSel = [...body.querySelectorAll('.form-row')].find((r) => r.textContent.startsWith('Type')).querySelector('select');
      typeSel.value = 'one';
      typeSel.dispatchEvent(new Event('change'));
      void type;
      return true;
    };
    await app.commands.run('perspective.define');
    expect(gridOf(doc).type).toBe('one');
    expect(doc.undoLabel).toBe('Define Perspective Grid');
  });

  it('saves the grid as a preset and lists it', async () => {
    app.dialogs.form = async () => ({ name: 'My Street' });
    await app.commands.run('perspective.savePreset');
    expect(userPresets(app.prefs).map((p) => p.name)).toContain('My Street');
    const items = app.menuSources.get('perspectivePresets')(app);
    expect(items.map((i) => i.label)).toContain('My Street');
  });

  it('ungroups perspective objects into pieces that stay in perspective', async () => {
    const ed = app.editor;
    const doc = ed.doc;
    const g = gridOf(doc);
    const a = createPath(rectangle(g.ox + 20, g.oy - 100, 30, 30), true);
    const b = createPath(rectangle(g.ox + 80, g.oy - 100, 30, 30), true);
    doc.transact('add', () => {
      doc.insert(a, ed.targetLayer().id);
      doc.insert(b, ed.targetLayer().id);
    });
    ed.select([a.id, b.id]);
    await app.commands.run('object.group');
    setPState(ed, { visible: true, plane: 'right' });
    await app.commands.run('perspective.attach');
    await app.commands.run('object.ungroup');
    const sel = ed.topSelection();
    expect(sel).toHaveLength(2);
    expect(sel.every((id) => isPerspective(doc.get(id)))).toBe(true);
  });

  it('opens the presets dialog and applies a preset', async () => {
    let body = null;
    app.dialogs.open = async (o) => {
      body = o.body;
      const items = [...body.querySelectorAll('[role="option"]')];
      items.find((i) => i.textContent.includes("Bird's Eye")).click();
      return 'apply';
    };
    await app.commands.run('edit.perspectivePresets');
    expect(body.querySelector('[role="listbox"]')).toBeTruthy();
    expect(gridOf(app.editor.doc).type).toBe('three');
    expect(gridOf(app.editor.doc).name).toBe("Three Point, Bird's Eye");
  });
});

describe('perspective overlay', () => {
  it('draws the grid, controls, rulers and selected objects without errors', () => {
    const ed = app.editor;
    const doc = ed.doc;
    for (const type of ['one', 'two', 'three']) {
      app.commands.run(`perspective.${type}`);
      setPState(ed, { visible: true, plane: 'right', rulers: true, snap: false });
      const g = gridOf(doc);
      app.setTool('rectangle');
      drag(app, { x: g.ox + 40, y: g.oy - 150 }, { x: g.ox + 140, y: g.oy - 60 });
      app.setTool('perspective-grid');
      const view = app.views.get(ed);
      ed.hover = ed.topSelection()[0];
      expect(() => view.renderNow()).not.toThrow();
      app.setTool('perspective-select');
      expect(() => view.renderNow()).not.toThrow();
      expect(app.tool.box()).toBeTruthy();
    }
  });
});

