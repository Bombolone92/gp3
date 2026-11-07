/**
 * Transform controls shared by the Properties and Transform panels:
 * reference point, X, Y, W, H (with proportional link), rotation, and
 * flip buttons. Values are relative to the active artboard's top-left like
 * artboard rulers, in the document's units.
 */
import { h } from '../../lib/dom.js';
import { numberField, iconButton } from '../widgets.js';
import { scale, translate, rotate } from '../../lib/matrix.js';
import { applyTransform } from '../../commands/core.js';
import { frameToDoc, frameMatrix } from '../../model/geometry.js';

const REF_POINTS = [
  [0, 0], [0.5, 0], [1, 0],
  [0, 0.5], [0.5, 0.5], [1, 0.5],
  [0, 1], [0.5, 1], [1, 1],
];
const REF_NAMES = ['Top left', 'Top center', 'Top right', 'Middle left', 'Center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right'];

export const transformState = { ref: 4, link: false };

/**
 * Rotation a selection reports: the angle of its bounding box frame (the
 * rotation the objects accumulated since they were drawn or since Reset
 * Bounding Box), counterclockwise positive. Mixed angles report 0.
 */
export function selectionRotation(editor) {
  const f = editor.selectionFrame?.();
  return f ? normDeg(-f.angle) : 0;
}

function normDeg(d) {
  const v = ((d % 360) + 540) % 360 - 180;
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/**
 * The 9-point reference point selector (a radio group operated with the
 * arrow keys). `onChange(index)` runs when the user picks a point; `set`
 * updates the shown point without calling it.
 */
export function referencePointGrid(index, onChange) {
  const el = h('div.ref-grid', { role: 'radiogroup', 'aria-label': 'Reference point' });
  let current = index;
  const btns = REF_POINTS.map((_, i) =>
    h('button.ref-dot', {
      type: 'button',
      role: 'radio',
      'aria-label': REF_NAMES[i],
      'aria-checked': String(i === index),
      tabindex: i === index ? '0' : '-1',
      onclick: () => pick(i),
      onkeydown: (e) => {
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
        if (!(e.key in moves)) return;
        e.preventDefault();
        const n = Math.max(0, Math.min(8, current + moves[e.key]));
        pick(n);
        btns[n].focus();
      },
    }),
  );
  el.append(...btns);
  const set = (i) => {
    current = i;
    btns.forEach((b, k) => {
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
    });
  };
  const pick = (i) => {
    set(i);
    onChange(i);
  };
  return { el, set, get: () => current };
}

/** Fractions [fx, fy] of the box for reference point index i (0..8, row by row). */
export const refFractions = (i) => REF_POINTS[i] || REF_POINTS[4];

export function createTransformSection(app, { compact = false } = {}) {
  const unit = () => app.editor?.doc.root.units || 'pt';
  const ref = referencePointGrid(transformState.ref, (i) => {
    transformState.ref = i;
    refresh();
  });
  const refGrid = ref.el;

  // The selection's box in its frame: W and H are measured along a turned box's own axes.
  const bounds = () => app.editor?.selectionFrame();
  const refLocal = (b) => {
    const [fx, fy] = REF_POINTS[transformState.ref];
    return { x: b.x + b.w * fx, y: b.y + b.h * fy };
  };
  const refPoint = (b) => {
    const p = refLocal(b);
    return frameToDoc(b, p.x, p.y);
  };
  const origin = () => (app.editor && app.rulerOrigin?.(app.editor)) || app.editor?.artboard() || { x: 0, y: 0 };

  const commitMove = (axis, v) => {
    const ed = app.editor;
    const b = bounds();
    if (!b) return;
    const p = refPoint(b);
    const o = origin();
    const dx = axis === 'x' ? v + o.x - p.x : 0;
    const dy = axis === 'y' ? v + o.y - p.y : 0;
    if (dx || dy) applyTransform(ed, 'Move', translate(dx, dy));
  };
  const commitSize = (axis, v) => {
    const ed = app.editor;
    const b = bounds();
    if (!b || v <= 0) return;
    const p = refLocal(b);
    let sx = axis === 'w' ? (b.w ? v / b.w : 1) : 1;
    let sy = axis === 'h' ? (b.h ? v / b.h : 1) : 1;
    if (transformState.link) {
      if (axis === 'w') sy = sx;
      else sx = sy;
    }
    // Zero-width (lines) cannot scale on that axis.
    if (!b.w) sx = 1;
    if (!b.h) sy = 1;
    applyTransform(ed, 'Scale', frameMatrix(b, scale(sx, sy, p.x, p.y)));
  };
  const commitRotate = (v) => {
    const ed = app.editor;
    const b = bounds();
    if (!b) return;
    const p = refPoint(b);
    const cur = selectionRotation(ed);
    const delta = v - cur;
    if (delta) applyTransform(ed, 'Rotate', rotate(-delta, p.x, p.y));
  };

  const fx = numberField({ label: 'X', value: 0, unit: unit(), onCommit: (v) => commitMove('x', v) });
  const fy = numberField({ label: 'Y', value: 0, unit: unit(), onCommit: (v) => commitMove('y', v) });
  const fw = numberField({ label: 'W', value: 0, unit: unit(), min: 0, onCommit: (v) => commitSize('w', v) });
  const fh = numberField({ label: 'H', value: 0, unit: unit(), min: 0, onCommit: (v) => commitSize('h', v) });
  const fr = numberField({ label: 'Rotate', kind: 'angle', value: 0, icon: 'rotate-ccw', onCommit: (v) => commitRotate(v) });
  const link = iconButton('unlink', 'Constrain width and height proportions', () => {
    transformState.link = !transformState.link;
    refresh();
  }, { pressed: transformState.link, className: 'link-btn' });
  const flipH = iconButton('flip-h', 'Flip Horizontal', () => app.commands.run('object.flipH'));
  const flipV = iconButton('flip-v', 'Flip Vertical', () => app.commands.run('object.flipV'));

  const el = h(
    'div.transform-section',
    h('div.tf-grid', refGrid, h('div.tf-fields', fx.el, fw.el, fy.el, fh.el), link),
    h('div.tf-row', fr.el, h('div.tf-flips', flipH, flipV)),
  );
  if (compact) el.classList.add('compact');

  function refresh() {
    const ed = app.editor;
    const b = ed ? bounds() : null;
    const u = unit();
    for (const f of [fx, fy, fw, fh]) f.setUnit(u);
    const disabled = !b;
    for (const f of [fx, fy, fw, fh, fr]) f.input.disabled = disabled;
    flipH.disabled = flipV.disabled = disabled;
    ref.set(transformState.ref);
    link.setAttribute('aria-pressed', String(transformState.link));
    link.replaceChildren(...iconButton(transformState.link ? 'link' : 'unlink', '', null).childNodes);
    if (!b) {
      for (const f of [fx, fy, fw, fh, fr]) f.set(null);
      return;
    }
    const p = refPoint(b);
    const o = origin();
    fx.set(p.x - o.x);
    fy.set(p.y - o.y);
    fw.set(b.w);
    fh.set(b.h);
    fr.set(selectionRotation(ed));
  }

  return { el, refresh };
}
