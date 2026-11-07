import { describe, it, expect } from 'vitest';
import axe from 'axe-core';
import { bootAppWithFeatures } from './helpers.js';
import { createPath, createText } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { isLive } from '../src/model/live.js';
import { threeDOf } from '../src/features/three-d/params.js';
import { MENUS } from '../src/ui/menus.js';

const solid = (color) => ({ type: 'solid', color });
const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const app = await bootAppWithFeatures();
  app.newDocument();
  const doc = app.editor.doc;
  const n = createPath(rectangle(100, 100, 100, 50), true, { fill: solid('#cc3333'), stroke: null });
  doc.transact('Rect', () => doc.insert(n, app.editor.targetLayer().id));
  app.editor.select([n.id]);
  return { app, doc, id: n.id, ed: app.editor };
}

const panelOf = (app) => app.dock.panels.get('3d');
const fx = (doc, id) => threeDOf(doc.get(id))?.fx;
const labelled = (root, text) => {
  const l = [...root.querySelectorAll('label')].find((x) => x.textContent.trim() === text && x.htmlFor);
  return l ? root.querySelector(`#${CSS.escape(l.htmlFor)}`) : null;
};

describe('3D commands', () => {
  it('lists the four types under Effect > 3D and Materials and enables them with a selection', async () => {
    const { app, ed } = await setup();
    const effect = MENUS.find((m) => m.label === 'Effect');
    const sub = effect.submenu.find((i) => i.label === '3D and Materials');
    expect(sub.submenu).toEqual(['effect.3d.extrude', 'effect.3d.revolve', 'effect.3d.inflate', 'effect.3d.rotate']);
    for (const id of sub.submenu) {
      const c = app.commands.get(id);
      expect(c).toBeTruthy();
      expect(c.enabled(app)).toBe(true);
    }
    ed.select([]);
    expect(app.commands.get('effect.3d.extrude').enabled(app)).toBe(false);
    expect(app.commands.get('panel.3d')).toBeTruthy();
  });

  it('applies a 3D effect as one undo step and opens the panel on the Object tab', async () => {
    const { app, doc, id } = await setup();
    await app.commands.run('effect.3d.extrude');
    expect(fx(doc, id).kind).toBe('extrude');
    expect(isLive(doc.get(id))).toBe(true);
    expect(app.dock.isOpen('3d')).toBe(true);
    const p = panelOf(app);
    expect(p.tab).toBe('object');
    // The anchors are untouched: the effect is live.
    expect(doc.get(id).anchors).toHaveLength(4);
    doc.undo();
    expect(fx(doc, id)).toBeUndefined();
    doc.redo();
    expect(fx(doc, id).kind).toBe('extrude');
  });

  it('switches type, keeping the orientation, and Apply Last Effect repeats it', async () => {
    const { app, doc, id, ed } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    p.apply({ rotX: 40, rotY: 10, rotZ: 5 });
    await app.commands.run('effect.3d.revolve');
    const r = fx(doc, id);
    expect(r.kind).toBe('revolve');
    expect([r.rotX, r.rotY, r.rotZ]).toEqual([40, 10, 5]);
    expect(doc.get(id).effects.filter((e) => e.type === 'threeD')).toHaveLength(1);
    const other = createPath(rectangle(300, 100, 50, 50), true, { fill: solid('#3333cc') });
    doc.transact('Rect', () => doc.insert(other, ed.targetLayer().id));
    ed.select([other.id]);
    await app.commands.run('effect.applyLast');
    expect(fx(doc, other.id).kind).toBe('revolve');
    expect(fx(doc, other.id).rotX).toBe(40);
  });

  it('applies to groups and type', async () => {
    const { app, doc, id, ed } = await setup();
    const t = createText('3D', 50, 300);
    doc.transact('Text', () => doc.insert(t, ed.targetLayer().id));
    ed.select([t.id]);
    await app.commands.run('effect.3d.extrude');
    expect(fx(doc, t.id).kind).toBe('extrude');
    expect(isLive(doc.get(t.id))).toBe(true);
    ed.select([id]);
    await app.commands.run('object.group');
    const g = [...ed.selection][0];
    expect(doc.get(g).type).toBe('group');
    await app.commands.run('effect.3d.inflate');
    expect(fx(doc, g).kind).toBe('inflate');
    expect(fx(doc, id)).toBeUndefined();
  });
});

describe('3D and Materials panel', () => {
  it('shows a hint without a 3D effect and adds one when a type is picked', async () => {
    const { app, doc, id } = await setup();
    app.openPanel('3d');
    const p = panelOf(app);
    p.update();
    expect(p.empty.hidden).toBe(false);
    expect(p.empty.textContent).toMatch(/Choose a 3D type/);
    const revolve = [...p.el.querySelectorAll('.td-choice-big')].find((b) => b.dataset.value === 'revolve');
    revolve.click();
    await tick();
    expect(fx(doc, id).kind).toBe('revolve');
    p.update();
    expect(p.empty.hidden).toBe(true);
    expect(p.revolveBox.hidden).toBe(false);
    expect(p.extrudeBox.hidden).toBe(true);
  });

  it('edits depth, bevel and rotation from its controls', async () => {
    const { app, doc, id } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    p.update();
    const depth = p.el.querySelector('input.td-num[aria-label^="Depth"]');
    depth.value = '80';
    depth.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fx(doc, id).depth).toBe(80);
    p.bevel.sel.value = 'round';
    p.bevel.sel.dispatchEvent(new Event('change'));
    expect(fx(doc, id).bevel).toBe('round');
    p.update();
    expect(p.bevelBox.hidden).toBe(false);
    p.view.sel.value = 'isoLeft';
    p.view.sel.dispatchEvent(new Event('change'));
    expect(fx(doc, id).rotY).toBe(45);
    // Arrow keys on the trackball turn the object in steps.
    const before = fx(doc, id).rotY;
    p.ball.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(fx(doc, id).rotY).not.toBe(before);
    p.update();
    expect(p.view.sel.value).toBe('');
  });

  it('merges a drag into one undo step and renders full quality at the end', async () => {
    const { app, doc, id } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    const undoDepth = doc.undoStack.length;
    p.apply({ rotY: 10 }, { live: true });
    p.apply({ rotY: 20 }, { live: true });
    p.apply({ rotY: 30 }, { live: true });
    expect(p.gesture).toBeTruthy();
    p.endGesture();
    expect(p.gesture).toBe(null);
    expect(fx(doc, id).rotY).toBe(30);
    expect(doc.undoStack.length).toBe(undoDepth + 1);
    doc.undo();
    expect(fx(doc, id).rotY).toBe(-28);
  });

  it('applies material and light presets and toggles shadows', async () => {
    const { app, doc, id } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    p.showTab('material');
    expect(p.pages.get('material').hidden).toBe(false);
    expect(p.pages.get('object').hidden).toBe(true);
    const chrome = p.el.querySelector('.td-swatch[data-id="chrome"]');
    chrome.click();
    expect(fx(doc, id).material).toBe('chrome');
    expect(fx(doc, id).metallic).toBe(1);
    p.update();
    expect(chrome.getAttribute('aria-pressed')).toBe('true');
    // Editing a surface setting makes the material custom.
    const rough = p.el.querySelector('input.td-num[aria-label^="Roughness"]');
    rough.value = '50';
    rough.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(fx(doc, id).roughness).toBeCloseTo(0.5);
    expect(fx(doc, id).material).toBe('custom');
    p.showTab('light');
    p.lightPreset.sel.value = 'side';
    p.lightPreset.sel.dispatchEvent(new Event('change'));
    expect(fx(doc, id).lightX).toBeGreaterThan(0.5);
    p.shadow.input.click();
    expect(fx(doc, id).shadow).toBe(true);
    p.behind.input.click();
    expect(fx(doc, id).lightZ).toBeLessThan(0);
    p.shading.buttons.find((b) => b.dataset.value === 'banded').click();
    expect(fx(doc, id).shading).toBe('banded');
    p.update();
    expect(p.steps.el.hidden).toBe(false);
  });

  it('switches tabs with the arrow keys', async () => {
    const { app } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    p.tabButtons.get('object').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.tab).toBe('material');
    p.tabButtons.get('material').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.tab).toBe('light');
    expect(p.tabButtons.get('light').getAttribute('aria-selected')).toBe('true');
  });

  it('removes the effect and expands it into faces', async () => {
    const { app, doc, id, ed } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    p.removeBtn.click();
    expect(fx(doc, id)).toBeUndefined();
    await app.commands.run('effect.3d.extrude');
    await app.commands.run('object.expandAppearance');
    const g = doc.get([...ed.selection][0]);
    expect(g.type).toBe('group');
    expect(g.children.length).toBe(3);
    expect(doc.has(id)).toBe(false);
  });

  it('opens from the Appearance panel to edit the effect', async () => {
    const { app, doc, id } = await setup();
    await app.commands.run('effect.3d.extrude');
    app.dock.openPanel('appearance');
    expect(app.dock.isOpen('3d')).toBe(false);
    const ap = app.dock.panels.get('appearance');
    ap.update();
    const idx = doc.get(id).effects.findIndex((e) => e.type === 'threeD');
    ap.editEffect(idx);
    await tick();
    expect(app.dock.isOpen('3d')).toBe(true);
    // Its row reads as a 3D effect.
    expect(ap.el.textContent).toContain('3D: Extrude');
  });

  it('has no serious accessibility violations on any tab', async () => {
    const { app } = await setup();
    await app.commands.run('effect.3d.extrude');
    const p = panelOf(app);
    for (const tab of ['object', 'material', 'light']) {
      p.showTab(tab);
      await tick();
      const result = await axe.run(p.el, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${tab} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    }
  });
});
