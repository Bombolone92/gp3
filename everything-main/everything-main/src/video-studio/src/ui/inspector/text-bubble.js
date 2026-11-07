/**
 * Bubble sub-tab of the Text tab: a grid of shapes drawn behind the text
 * (thumbnails come from the same drawing code) with fill, outline color and
 * outline width.
 */
import { h, announce } from '../../lib/dom.js';
import { BUBBLES } from '../../engine/bubbles.js';
import { slider, color, propSection, choiceGrid } from './common.js';
import { lookCanvas } from '../text-thumbs.js';

const SAMPLE = { text: 'Hi!', style: { font: 'Poppins', bold: true, size: 64, color: '#111111', bubbleFill: '#ffffff', bubbleStroke: '#111111', bubbleStrokeWidth: 4 } };

export function bubbleThumb(id, w = 104, hh = 104) {
  return lookCanvas({ ...SAMPLE, style: { ...SAMPLE.style, bubble: id } }, w, hh, { className: 'preset-canvas', bg: null, maxScale: 0.9 });
}

export function bubbleTab(view) {
  const grid = choiceGrid({
    label: 'Bubbles',
    className: 'preset-grid bubble-grid',
    items: [{ id: null, label: 'None' }, ...BUBBLES].map((b) => ({ id: b.id, label: b.label, preview: b.id ? bubbleThumb(b.id) : h('span.anim-demo', { dataset: { anim: 'none' } }) })),
    value: view.clip.style.bubble || null,
    onPick: (id) => {
      view.edit(id ? 'Add bubble' : 'Remove bubble', (c) => {
        c.style.bubble = id || '';
        // A light bubble needs dark text to stay readable.
        if (id && c.style.color.toLowerCase() === '#ffffff' && c.style.bubbleFill.toLowerCase() === '#ffffff') c.style.color = '#111111';
      });
      announce(id ? `${BUBBLES.find((b) => b.id === id).label} bubble` : 'Bubble removed');
    },
  });
  const set = (key, label) => (v, final) => view.edit(label, (c) => {
    c.style[key] = v;
  }, { key: `style-${key}`, final });
  const fill = color(view, { label: 'Fill', get: (c) => c.style.bubbleFill, set: set('bubbleFill', 'Bubble fill') });
  const stroke = color(view, { label: 'Outline', get: (c) => c.style.bubbleStroke, set: set('bubbleStroke', 'Bubble outline') });
  const width = slider(view, { label: 'Outline width', min: 0, max: 20, get: (c) => Math.round(c.style.bubbleStrokeWidth), set: set('bubbleStrokeWidth', 'Bubble outline width') });
  const look = propSection('Bubble colors', [fill.el, stroke.el, width.el]);
  const paint = () => {
    const c = view.clip;
    if (!c) return;
    grid.set(c.style.bubble || null);
    look.hidden = !c.style.bubble;
  };
  paint();
  view.bind(paint);
  return h('div.text-bubbles', h('div.anim-grid-wrap', grid.el), look);
}
