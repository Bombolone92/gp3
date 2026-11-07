// Character Edit tool: pick a character, move, scale and rotate it as run attributes.
import { describe, it, expect, beforeEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createText } from '../src/model/nodes.js';
import { layoutText, glyphPlacements } from '../src/model/text-layout.js';
import { styleAt } from '../src/model/text-runs.js';
import { placementOf, charBox } from '../src/features/type/char-edit-tool.js';

const CHAR = { fontFamily: 'Approx Sans', fontWeight: 400, fontStyle: 'normal', fontSize: 100 };
let app;
let doc;
let tool;

const ev = (x, y, extra = {}) => {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, ...extra };
};

/** Document point at the middle of character i. */
function charCenter(id, i) {
  const p = placementOf(doc, id, i);
  const b = charBox(p.frame, p.lay, p.g);
  return { x: (b.pts[0].x + b.pts[2].x) / 2, y: (b.pts[0].y + b.pts[2].y) / 2, box: b };
}

beforeEach(async () => {
  app = await bootAppWithFeatures();
  if (!app.editor) app.newDocument();
  doc = app.editor.doc;
  app.editor.view.set?.({ zoom: 1, panX: 0, panY: 0 });
  app.setTool('character-edit');
  tool = app.tool;
});

function addText() {
  const t = createText('ABCD', 100, 300, { char: { ...CHAR } });
  doc.transact('Add', () => doc.insert(t, app.editor.targetLayer().id));
  return t;
}

describe('Character Edit tool', () => {
  it('is registered with Shift+T', () => {
    expect(tool.constructor.id).toBe('character-edit');
    expect(tool.constructor.shortcut).toBe('Shift+T');
  });

  it('selects the character under the pointer', () => {
    const t = addText();
    const c = charCenter(t.id, 2);
    tool.onPointerDown(ev(c.x, c.y));
    tool.onPointerUp(ev(c.x, c.y));
    expect(tool.target).toEqual({ id: t.id, i: 2 });
    expect(app.editor.selection.has(t.id)).toBe(true);
  });

  it('dragging moves the character with kerning and baseline shift while the rest stays put', () => {
    const t = addText();
    const before = glyphPlacements(layoutText(doc.get(t.id))).map((g) => g.m[4]);
    const c = charCenter(t.id, 1);
    tool.onPointerDown(ev(c.x, c.y));
    tool.onPointerMove(ev(c.x + 20, c.y - 30));
    tool.onPointerUp(ev(c.x + 20, c.y - 30));
    const n = doc.get(t.id);
    expect(styleAt(n, 1).kerning).toBeCloseTo(200);
    expect(styleAt(n, 1).baselineShift).toBeCloseTo(30);
    expect(styleAt(n, 2).kerning).toBeCloseTo(-200);
    const after = glyphPlacements(layoutText(n)).map((g) => g.m[4]);
    expect(after[1] - before[1]).toBeCloseTo(20);
    expect(after[2]).toBeCloseTo(before[2]);
    expect(after[3]).toBeCloseTo(before[3]);
    app.commands.run('edit.undo');
    expect(doc.get(t.id).runs).toBeUndefined();
  });

  it('the corner handles scale and the knob rotates', () => {
    const t = addText();
    const c = charCenter(t.id, 0);
    tool.onPointerDown(ev(c.x, c.y));
    tool.onPointerUp(ev(c.x, c.y));
    const view = app.editor.view;
    const s = c.box.pts.map((q) => view.toScreen(q.x, q.y));
    expect(tool.partAt(s[2].x, s[2].y)).toBe('br');
    expect(tool.partAt(s[0].x, s[0].y)).toBe('tl');
    // Horizontal scale: drag the bottom-right corner right by the box width.
    const w = c.box.pts[1].x - c.box.pts[0].x;
    tool.onPointerDown(ev(c.box.pts[2].x, c.box.pts[2].y));
    tool.onPointerMove(ev(c.box.pts[2].x + w, c.box.pts[2].y));
    tool.onPointerUp(ev(c.box.pts[2].x + w, c.box.pts[2].y));
    expect(styleAt(doc.get(t.id), 0).horizontalScale).toBeCloseTo(200, 0);
    // Rotate a quarter turn counterclockwise around the box center.
    const c2 = charCenter(t.id, 0);
    const s2 = c2.box.pts.map((q) => view.toScreen(q.x, q.y));
    const knob = tool.knobPos(s2);
    expect(tool.partAt(knob.x, knob.y)).toBe('rotate');
    const center = { x: (s2[0].x + s2[2].x) / 2, y: (s2[0].y + s2[2].y) / 2 };
    const r = Math.hypot(knob.x - center.x, knob.y - center.y);
    const k = view.toDoc(knob.x, knob.y);
    tool.onPointerDown({ ...ev(k.x, k.y), sx: knob.x, sy: knob.y });
    const to = { sx: center.x - r, sy: center.y };
    const td = view.toDoc(to.sx, to.sy);
    tool.onPointerMove({ ...ev(td.x, td.y), ...to });
    tool.onPointerUp({ ...ev(td.x, td.y), ...to });
    expect(Math.abs(styleAt(doc.get(t.id), 0).rotation)).toBeCloseTo(90, 0);
  });

  it('arrow keys nudge and Tab steps to the next character', () => {
    const t = addText();
    const c = charCenter(t.id, 0);
    tool.onPointerDown(ev(c.x, c.y));
    tool.onPointerUp(ev(c.x, c.y));
    tool.onKeyDown({ key: 'ArrowUp', shiftKey: true });
    expect(styleAt(doc.get(t.id), 0).baselineShift).toBe(10);
    tool.onKeyDown({ key: 'Tab', shiftKey: false });
    expect(tool.target.i).toBe(1);
    tool.onKeyDown({ key: 'ArrowRight', shiftKey: false });
    expect(styleAt(doc.get(t.id), 1).kerning).toBe(10);
    expect(styleAt(doc.get(t.id), 2).kerning).toBe(-10);
    tool.onKeyDown({ key: 'Escape' });
    expect(tool.target).toBeNull();
  });
});
