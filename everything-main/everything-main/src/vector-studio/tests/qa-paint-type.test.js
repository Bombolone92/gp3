import { describe, it, expect, beforeEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createPath, createText } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { commonStyle } from '../src/ops/paint-ops.js';
import { applyRunStyle } from '../src/model/text-runs.js';

const red = { type: 'solid', color: '#ff0000' };
const blue = { type: 'solid', color: '#0000ff' };

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}

function add(app, node) {
  const doc = app.editor.doc;
  doc.transact('Add', () => doc.insert(node, app.editor.targetLayer().id));
  return doc.get(node.id);
}

/** Point type whose characters are all colored through runs (as when styling selected characters). */
function redText(app, text = 'Hello') {
  const t = createText(text, 100, 100);
  return add(app, { ...t, runs: applyRunStyle(t, 0, text.length, { fill: red }) });
}

describe('QA: paint and type', () => {
  let app;
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  });

  it('reports the characters’ fill for a selected text object whose runs override it', () => {
    const t = redText(app);
    app.editor.select([t.id]);
    expect(commonStyle(app.editor, 'fill')).toEqual(red);
    const r = add(app, createPath(rectangle(0, 0, 10, 10), true, { fill: red }));
    app.editor.select([t.id, r.id]);
    expect(commonStyle(app.editor, 'fill')).toEqual(red);
    app.editor.select([r.id]);
    expect(commonStyle(app.editor, 'fill')).toEqual(red);
  });

  it('Eyedropper samples the character under the pointer and applies to text through its runs', () => {
    const t = redText(app);
    const r = add(app, createPath(rectangle(0, 300, 50, 50), true, { fill: blue }));
    app.editor.select([r.id]);
    app.setTool('eyedropper');
    app.tool.onPointerDown(ev(app, 103, 97));
    expect(app.editor.doc.get(r.id).fill).toEqual(red);
    // Option-click applies the current appearance to the text, replacing the run colors.
    app.editor.setStyle({ fill: blue });
    app.tool.onPointerDown(ev(app, 103, 97, { alt: true }));
    const after = app.editor.doc.get(t.id);
    expect(after.fill).toEqual(blue);
    expect(after.runs).toBeUndefined();
  });
});

describe('QA: swap fill and stroke', () => {
  it('swaps the character fill and stroke of styled type too', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    const t = redText(app);
    app.editor.select([t.id]);
    const { swapFillStroke } = await import('../src/ops/paint-ops.js');
    swapFillStroke(app.editor);
    const n = app.editor.doc.get(t.id);
    const { styleAt } = await import('../src/model/text-runs.js');
    expect(styleAt(n, 0).fill).toBe(null);
    expect(styleAt(n, 0).stroke).toEqual(red);
  });
});

describe('QA: gradients on moved type', () => {
  const grad = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }] };

  async function movedText() {
    const { VDocument } = await import('../src/model/document.js');
    const { transformNodes } = await import('../src/model/geometry.js');
    const doc = VDocument.create();
    const layer = doc.root.children[0];
    const t = createText('GRADIENT', 60, 100, { fill: grad });
    doc.transact('t', () => doc.insert(t, layer));
    doc.transact('move', () => transformNodes(doc, [t.id], [1, 0, 0, 1, 200, 100]));
    return { doc, node: doc.get(t.id) };
  }

  it('draws the gradient across the text where it is, not offset by its transform', async () => {
    const { installCanvasStub } = await import('./helpers.js');
    installCanvasStub();
    const { drawNode } = await import('../src/render/draw.js');
    const { nodeBounds } = await import('../src/model/geometry.js');
    const { doc, node } = await movedText();
    const ctx = document.createElement('canvas').getContext('2d');
    const calls = [];
    let shift = [0, 0];
    ctx.translate = (x, y) => (shift = [x, y]);
    ctx.createLinearGradient = (...a) => (calls.push([a[0] + shift[0], a[1] + shift[1], a[2] + shift[0], a[3] + shift[1]]), { addColorStop() {} });
    drawNode(ctx, doc, node, { scale: 1 });
    expect(calls.length).toBeGreaterThan(0);
    // In the text's local space (where its runs are placed), the gradient spans the text frame.
    const b = nodeBounds(doc, node);
    expect(calls[0][0]).toBeCloseTo(b.x - 200, 3);
    expect(calls[0][2]).toBeCloseTo(b.x + b.w - 200, 3);
  });

  it('writes the gradient of moved live type in the text element’s own space in SVG', async () => {
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const { nodeBounds } = await import('../src/model/geometry.js');
    const { doc, node } = await movedText();
    const b = nodeBounds(doc, node);
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    const x1 = Number(svg.match(/<linearGradient[^>]* x1="([-\d.]+)"/)[1]);
    expect(x1).toBeCloseTo(b.x - 200, 1);
  });

  it('writes the gradient of horizontally scaled type in the scaled piece’s space in SVG', async () => {
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const { VDocument } = await import('../src/model/document.js');
    const { nodeBounds } = await import('../src/model/geometry.js');
    const doc = VDocument.create();
    const t = createText('WIDE', 100, 100, { fill: grad });
    t.char = { ...t.char, horizontalScale: 200 };
    doc.transact('t', () => doc.insert(t, doc.root.children[0]));
    const b = nodeBounds(doc, doc.get(t.id));
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    const x1 = Number(svg.match(/<linearGradient[^>]* x1="([-\d.]+)"/)[1]);
    const x2 = Number(svg.match(/<linearGradient[^>]* x2="([-\d.]+)"/)[1]);
    // The piece is drawn under translate(100 y) scale(2 1): the frame maps back to 0..w/2.
    expect(x1).toBeCloseTo((b.x - 100) / 2, 1);
    expect(x2).toBeCloseTo((b.x + b.w - 100) / 2, 1);
  });
});

describe('QA: gradients follow transforms', () => {
  const grad = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }] };
  const about = (deg, cx, cy) => {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  };

  it('rotates a fitted gradient with its object and keeps it fitted on a plain move', async () => {
    const { VDocument } = await import('../src/model/document.js');
    const { transformNodes, gradientGeometry, nodeBounds } = await import('../src/model/geometry.js');
    const doc = VDocument.create();
    const r = createPath(rectangle(0, 0, 200, 100), true, { fill: grad });
    doc.transact('r', () => doc.insert(r, doc.root.children[0]));
    doc.transact('move', () => transformNodes(doc, [r.id], [1, 0, 0, 1, 10, 0]));
    expect(doc.get(r.id).fill.x1).toBeUndefined();
    doc.transact('rotate', () => transformNodes(doc, [r.id], about(90, 110, 50)));
    const n = doc.get(r.id);
    const g = gradientGeometry(n.fill, nodeBounds(doc, n));
    // Left-to-right before; after a 90 degree turn (y down) it runs top to bottom.
    expect(g.x1).toBeCloseTo(110);
    expect(g.x2).toBeCloseTo(110);
    expect(g.y2 - g.y1).toBeCloseTo(200);
  });

  it('turns the gradient of a compound path while dragging from the original subpaths', async () => {
    const { VDocument } = await import('../src/model/document.js');
    const { collectOriginals, transformFromOriginals, gradientGeometry, nodeBounds } = await import('../src/model/geometry.js');
    const { createCompound } = await import('../src/model/nodes.js');
    const doc = VDocument.create();
    const a = createPath(rectangle(0, 0, 200, 100), true);
    const c = createCompound([a.id], { fill: grad });
    doc.transact('c', () => doc.insert(c, doc.root.children[0], Infinity, [a]));
    const originals = collectOriginals(doc, [c.id]);
    const tx = doc.begin('Rotate');
    transformFromOriginals(doc, originals, about(45, 100, 50));
    transformFromOriginals(doc, originals, about(90, 100, 50));
    tx.commit();
    const n = doc.get(c.id);
    const g = gradientGeometry(n.fill, nodeBounds(doc, n));
    expect(g.x1).toBeCloseTo(100);
    expect(g.y1).toBeCloseTo(-50);
    expect(g.y2).toBeCloseTo(150);
  });
});

describe('QA: global swatches on styled characters', () => {
  it('editing a global swatch recolors the characters linked to it', async () => {
    const { VDocument } = await import('../src/model/document.js');
    const { addSwatch, updateSwatch, swatchUsage, paintFromSwatch, findSwatch, removeSwatches } = await import('../src/features/paint/swatch-model.js');
    const doc = VDocument.create();
    let id;
    doc.transact('sw', () => (id = addSwatch(doc, { name: 'Brand', paint: { type: 'solid', color: '#ff0000' }, global: true })));
    const t = createText('Hello', 0, 0);
    const paint = paintFromSwatch(findSwatch(doc, id));
    doc.transact('t', () => doc.insert({ ...t, runs: applyRunStyle(t, 0, 2, { fill: paint }) }, doc.root.children[0]));
    expect(swatchUsage(doc, id)).toBe(1);
    doc.transact('edit', () => updateSwatch(doc, id, { paint: { type: 'solid', color: '#00ff00' } }));
    expect(doc.get(t.id).runs[0].fill).toMatchObject({ color: '#00ff00', swatchId: id });
    doc.undo();
    expect(doc.get(t.id).runs[0].fill.color).toBe('#ff0000');
    doc.transact('del', () => removeSwatches(doc, [id]));
    expect(doc.get(t.id).runs[0].fill.swatchId).toBeUndefined();
  });
});

describe('QA: Edit Colors on styled type', () => {
  it('maps and collects the colors of styled characters', async () => {
    const { colorPatches, collectColors, invertColor } = await import('../src/features/paint/edit-colors.js');
    const t = createText('Hello', 0, 0);
    const n = { ...t, runs: applyRunStyle(t, 0, 5, { fill: red }) };
    expect(collectColors([n]).map((c) => c.color)).toEqual(['#ff0000']);
    const patch = colorPatches([n], invertColor).get(n.id);
    expect(patch.runs[0].fill.color).toBe('#00ffff');
  });
});

describe('QA: Outline Stroke keeps arrowheads', () => {
  it('outlines a dashed open path with arrowheads into stroke pieces plus the arrowheads', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { setGeomSource } = await import('../src/features/geometry/engine/index.js');
    setGeomSource(fs.readFileSync(path.resolve(__dirname, '../src/wasm/geom.wasm')));
    const { VDocument } = await import('../src/model/document.js');
    const { Editor } = await import('../src/editor.js');
    const { anchor } = await import('../src/model/bezier.js');
    const { outlineStroke } = await import('../src/features/geometry/path-ops.js');
    const { strokeAnchors, dashPattern } = await import('../src/features/paint/index.js');
    const { nodeArrowheads } = await import('../src/features/paint/stroke-geometry.js');
    const { nodeBounds } = await import('../src/model/geometry.js');
    const p = createPath([anchor(0, 0), anchor(200, 0)], false, { fill: null, stroke: blue, strokeWidth: 4, dash: [10, 5], arrowEnd: { shape: 'triangle', scale: 100, align: 'end' } });
    const doc = VDocument.create();
    const layer = doc.layers()[0];
    doc.transact('setup', () => doc.insert(p, layer.id));
    const prefs = { get: () => undefined, set: () => {} };
    const editor = new Editor(doc, { prefs });
    const app = { editor, notify: () => {}, prefs, strokeAnchors, dashPattern: (n) => dashPattern(n) || (n.dash?.length ? { dash: n.dash, offset: n.dashOffset || 0 } : null), arrowheadPaths: nodeArrowheads };
    editor.select([p.id]);
    await outlineStroke(app);
    const g = doc.get(doc.get(layer.id).children[0]);
    expect(g.type).toBe('group');
    const [dashes, head] = g.children.map((c) => doc.get(c));
    expect(dashes.type).toBe('compound');
    expect(dashes.fill).toEqual(blue);
    expect(head.fill).toEqual(blue);
    expect(head.arrowEnd).toBe(null);
    // The arrowhead tip sits on the path end; the dashes stop where it attaches.
    const hb = nodeBounds(doc, head);
    expect(hb.x + hb.w).toBeCloseTo(200, 0);
    expect(nodeBounds(doc, dashes).x + nodeBounds(doc, dashes).w).toBeLessThan(190);
  });
});

describe('QA: Properties header for type on a path', () => {
  it('names type on a path instead of calling it point type', async () => {
    const { selectionKind } = await import('../src/ui/panels/properties.js');
    const app = await bootAppWithFeatures();
    app.newDocument();
    const t = add(app, createText('along', 0, 0, { kind: 'path', pathAnchors: rectangle(0, 0, 100, 0).slice(0, 2), pathClosed: false }));
    app.editor.select([t.id]);
    expect(selectionKind(app.editor)).toBe('Type on a Path');
  });
});

describe('QA: graphic styles replace the whole appearance', () => {
  it('drops dashes and arrowheads a style does not have', async () => {
    const { applyGraphicStyle, DEFAULT_GRAPHIC_STYLES } = await import('../src/features/paint/graphic-styles.js');
    const app = await bootAppWithFeatures();
    app.newDocument();
    const p = add(app, createPath(rectangle(0, 0, 10, 10), true, { dash: [6, 4], dashAlign: 'corners', strokeCap: 'round', arrowEnd: { shape: 'arrow', scale: 100, align: 'end' } }));
    app.editor.select([p.id]);
    applyGraphicStyle(app.editor, DEFAULT_GRAPHIC_STYLES.find((s) => s.id === 'gs-paper').style);
    const n = app.editor.doc.get(p.id);
    expect(n.dash).toEqual([]);
    expect(n.dashAlign).toBeUndefined();
    expect(n.arrowEnd).toBe(null);
    expect(n.strokeCap).toBe('butt');
    expect(n.fill.color).toBe('#f4efe6');
  });
});

describe('QA: Enter in a dialog field commits it before OK', () => {
  it('applies a value typed into a change-driven field (like the hex field) when Enter closes the dialog', async () => {
    const { openDialog } = await import('../src/ui/dialogs/dialog.js');
    const { installCanvasStub } = await import('./helpers.js');
    installCanvasStub();
    let color = '3366cc';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = color;
    input.addEventListener('change', () => (color = input.value));
    const p = openDialog({ title: 'Color Picker', body: input, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: () => color }] });
    input.value = 'ff8800';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(await p).toBe('ff8800');
  });
});

describe('QA: undo while editing type', () => {
  it('keeps the selected characters when undoing a style change', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const t = add(app, createText('Hello World', 100, 100));
    app.setTool('type');
    const s = app.tool.editText(t.id, null);
    s.setSelection(6, 11);
    const { applyCharStyle } = await import('../src/features/type/type-ops.js');
    applyCharStyle(app, { fontSize: 36 }, { label: 'Font Size' });
    expect(app.editor.doc.get(t.id).runs).toBeTruthy();
    s.undo();
    expect(app.editor.doc.get(t.id).runs).toBeUndefined();
    expect(s.range()).toEqual([6, 11]);
  });
});

describe('QA: pasting copied artwork into type', () => {
  it('inserts the copied type objects’ text instead of SVG markup', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    const a = add(app, createText('Source', 100, 100));
    const b = add(app, createText('Target', 100, 200));
    app.editor.select([a.id]);
    const { copy, clipboard } = await import('../src/ops/clipboard.js');
    copy(app.editor);
    const svg = `<?xml version="1.0"?><!--vector-studio-clip:${clipboard.data.stamp}--><svg xmlns="http://www.w3.org/2000/svg"><text>Source</text></svg>`;
    app.setTool('type');
    const s = app.tool.editText(b.id, null);
    s.setSelection(6, 6);
    const ev = new Event('paste', { cancelable: true });
    ev.clipboardData = { getData: () => svg };
    s.onPaste(ev);
    expect(app.editor.doc.get(b.id).text).toBe('TargetSource');
    // Markup from an earlier copy (another stamp) falls back to the SVG's text elements.
    const { pastedText } = await import('../src/features/type/session.js');
    expect(pastedText(svg.replace(String(clipboard.data.stamp), '1'))).toBe('Source');
    expect(pastedText('plain words')).toBe('plain words');
  });
});

describe('QA: Edit Colors previews on styled type', () => {
  it('turning the preview off restores the characters’ colors', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    const t = redText(app);
    app.editor.select([t.id]);
    const done = app.commands.run('color.saturate');
    await new Promise((r) => setTimeout(r, 0));
    const dlg = document.querySelector('dialog[open]');
    const range = dlg.querySelector('input[type=range]');
    range.value = '-100';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.editor.doc.get(t.id).runs[0].fill.color).not.toBe('#ff0000');
    const preview = [...dlg.querySelectorAll('input[type=checkbox]')].pop();
    preview.checked = false;
    preview.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.editor.doc.get(t.id).runs[0].fill.color).toBe('#ff0000');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    await done;
  });
});

describe('QA: font picker keyboard', () => {
  it('Escape in the search field closes the font list', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    // jsdom has neither; the list lazily loads faces as rows scroll into view.
    Element.prototype.scrollIntoView ||= () => {};
    globalThis.IntersectionObserver ||= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const { createFontPicker } = await import('../src/features/type/font-picker.js');
    const picker = createFontPicker(app, { onPick: () => {} });
    document.body.append(picker.el);
    picker.el.click();
    const search = document.querySelector('.fp-search');
    expect(search).toBeTruthy();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.fp-search')).toBe(null);
  });
});

describe('QA: caret keys in type', () => {
  it('Up/Down after Left/Right start from the new caret column', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const t = add(app, createText('abcdef\nabcdef', 100, 100));
    app.setTool('type');
    const s = app.tool.editText(t.id, null);
    s.setSelection(1, 1);
    const key = (k) => s.handleKey({ key: k, code: k, target: s.input, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {} }, app.tool.keyActions());
    key('ArrowDown');
    expect(s.caret).toBe(8);
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowUp');
    expect(s.caret).toBe(3);
  });
});

describe('QA: caret keys in vertical type', () => {
  it('moves along the column with Up/Down and between columns with Left/Right', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const t = add(app, createText('ABCD\nEFGH', 300, 100, { vertical: true }));
    app.setTool('type');
    const s = app.tool.editText(t.id, null);
    s.setSelection(0, 0);
    const key = (k) => s.handleKey({ key: k, code: k, target: s.input, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() {} }, app.tool.keyActions());
    key('ArrowDown');
    expect(s.caret).toBe(1);
    key('ArrowLeft');
    expect(s.caret).toBe(6);
    key('ArrowUp');
    expect(s.caret).toBe(5);
    key('ArrowRight');
    expect(s.caret).toBe(0);
  });
});

describe('QA: Isolate Blending in SVG export', () => {
  it('writes isolation:isolate on isolated groups', async () => {
    const { VDocument } = await import('../src/model/document.js');
    const { createGroup } = await import('../src/model/nodes.js');
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const doc = VDocument.create();
    const a = createPath(rectangle(0, 0, 50, 50), true, { fill: red, blendMode: 'multiply' });
    const g = createGroup([a.id], { isolate: true });
    doc.transact('g', () => doc.insert(g, doc.root.children[0], Infinity, [{ ...a, parent: g.id }]));
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 100, h: 100 } });
    expect(svg).toMatch(/<g[^>]*isolation:isolate/);
    expect(svg).toMatch(/mix-blend-mode:multiply/);
  });
});

describe('QA: IME composition over a selection', () => {
  it('undoes the replaced selection and the composed text in one step', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    const t = add(app, createText('Hello', 100, 100));
    app.setTool('type');
    const s = app.tool.editText(t.id, null);
    s.setSelection(3, 5);
    s.onCompositionStart({});
    s.onCompositionUpdate({ data: 'に' });
    s.onCompositionUpdate({ data: 'にほ' });
    s.onCompositionEnd({ data: '日本' });
    expect(app.editor.doc.get(t.id).text).toBe('Hel日本');
    s.undo();
    expect(app.editor.doc.get(t.id).text).toBe('Hello');
  });
});

describe('QA: applying the paint an object already has', () => {
  it('adds no undo step', async () => {
    const app = await bootAppWithFeatures();
    app.newDocument();
    const r = add(app, createPath(rectangle(0, 0, 10, 10), true, { fill: red }));
    app.editor.select([r.id]);
    const { applyStyle } = await import('../src/ops/paint-ops.js');
    const before = app.editor.doc.undoStack.length;
    applyStyle(app.editor, { fill: { type: 'solid', color: '#ff0000' } }, 'Apply Swatch');
    expect(app.editor.doc.undoStack.length).toBe(before);
    applyStyle(app.editor, { fill: blue }, 'Apply Swatch');
    expect(app.editor.doc.undoStack.length).toBe(before + 1);
  });
});

describe('QA: type as a clipping path', () => {
  async function maskedDoc() {
    const { VDocument } = await import('../src/model/document.js');
    const { createGroup } = await import('../src/model/nodes.js');
    const doc = VDocument.create();
    const art = createPath(rectangle(80, 80, 400, 120), true, { fill: red, stroke: null });
    const t = createText('MASKED', 100, 170);
    const g = createGroup([art.id, t.id], { clip: true });
    doc.transact('g', () => doc.insert(g, doc.root.children[0], Infinity, [{ ...art, parent: g.id }, { ...t, parent: g.id }]));
    return { doc, g: doc.get(g.id) };
  }

  it('keeps the content only where the glyphs are on canvas', async () => {
    const { installCanvasStub } = await import('./helpers.js');
    installCanvasStub();
    const { drawNode } = await import('../src/render/draw.js');
    const { doc, g } = await maskedDoc();
    const { regionPool } = await import('../src/render/effects.js');
    const log = [];
    const acquire = regionPool.acquire;
    regionPool.acquire = (w, h) => {
      const l = acquire.call(regionPool, w, h);
      const ctx = new Proxy(l.ctx, {
        get: (t, k) => (k === 'fillText' ? (...a) => log.push(['fillText', t.globalCompositeOperation, a[0]]) : typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
        set: (t, k, v) => ((t[k] = v), true),
      });
      return { ...l, ctx };
    };
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      const clips = [];
      ctx.clip = (p) => clips.push(p);
      drawNode(ctx, doc, g, { scale: 1 });
      expect(clips).toHaveLength(0);
      expect(log).toContainEqual(['fillText', 'destination-in', 'MASKED']);
    } finally {
      regionPool.acquire = acquire;
    }
  });

  it('clips with the type’s glyphs in SVG instead of its bounding box', async () => {
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const { doc } = await maskedDoc();
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    expect(svg).toMatch(/<clipPath id="[^"]+">\s*<text[^>]*>MASKED<\/text>/);
  });
});
