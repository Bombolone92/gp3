/**
 * Anchored popovers (non-modal): close on Escape, outside click or when the
 * anchor is removed; focus returns to the anchor.
 */
import { h } from '../lib/dom.js';
import { createColorPicker } from './color-picker.js';
import { paintSwatch } from './widgets.js';
import { applyStyle, commonStyle, DEFAULT_GRADIENT } from '../ops/paint-ops.js';

let openPop = null;

export function openPopover(anchor, content, { label = 'Popover', onClose, placement = 'left' } = {}) {
  closePopover();
  const pop = h('div.popover', { role: 'dialog', 'aria-label': label, tabindex: '-1' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = placement === 'left' ? r.left - pw - 8 : r.left;
  let top = placement === 'left' ? r.top - 8 : r.bottom + 6;
  if (left < 4) left = Math.min(window.innerWidth - pw - 4, r.right + 8);
  top = Math.max(4, Math.min(window.innerHeight - ph - 4, top));
  pop.style.left = `${Math.max(4, left)}px`;
  pop.style.top = `${top}px`;
  const outside = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const key = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
      anchor.focus();
    }
  };
  pop.addEventListener('keydown', key);
  document.addEventListener('pointerdown', outside, true);
  openPop = {
    el: pop,
    close: () => {
      document.removeEventListener('pointerdown', outside, true);
      pop.remove();
      onClose?.();
    },
  };
  (pop.querySelector('[data-autofocus]') || pop.querySelector('button, input, [tabindex="0"]') || pop).focus();
  return openPop;
}

export function closePopover() {
  if (openPop) {
    const p = openPop;
    openPop = null;
    p.close();
  }
}

/** Fill or stroke editor: swatches plus a color picker, applied live to the selection. */
export function openPaintPopover(app, anchor, key) {
  const editor = app.editor;
  if (!editor) return;
  const cur = commonStyle(editor, key);
  const solid = cur && cur !== 'mixed' && cur.type === 'solid' ? cur.color : key === 'fill' ? '#ffffff' : '#000000';
  const coalesce = `paint-${key}-${Date.now()}`;
  const label = key === 'fill' ? 'Fill' : 'Stroke';
  const set = (paint) => applyStyle(editor, { [key]: paint }, `Change ${label}`, coalesce);
  const swatches = editor.doc.root.swatches || [];
  const grid = h('div.swatch-grid', { role: 'listbox', 'aria-label': `${label} swatches` });
  const noneBtn = h('button.swatch-cell', { type: 'button', role: 'option', 'aria-label': 'None', 'data-tip': 'None', onclick: () => set(null) }, paintSwatch(null));
  grid.append(noneBtn);
  for (const s of swatches) {
    grid.append(h('button.swatch-cell', { type: 'button', role: 'option', 'aria-label': s.name, 'data-tip': s.name, onclick: () => set(structuredClone(s.paint)) }, paintSwatch(s.paint)));
  }
  const picker = createColorPicker({ value: solid, label, onInput: (hex) => set({ type: 'solid', color: hex }) });
  const gradBtn = h('button.btn.small', { type: 'button', onclick: () => set(cur && cur !== 'mixed' && cur.type !== 'solid' ? cur : DEFAULT_GRADIENT) }, 'Gradient');
  const content = h('div.paint-popover', h('h3.popover-title', label), grid, picker.el, h('div.popover-actions', gradBtn));
  openPopover(anchor, content, { label: `${label} color` });
}
