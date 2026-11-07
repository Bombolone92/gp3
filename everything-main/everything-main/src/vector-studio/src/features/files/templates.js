/**
 * Starter templates for File > New from Template: small, original layouts
 * built from ordinary shapes and type so everything stays editable.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { VDocument } from '../../model/document.js';
import { createPath, createText, createLayer } from '../../model/nodes.js';
import { rectangle, ellipse } from '../../model/shapes.js';
import { takeUntitledName } from './new-document.js';

const solid = (color) => ({ type: 'solid', color });
const inch = (v) => v * 72;

function rect(x, y, w, hgt, fill, { r = 0, stroke = null, strokeWidth = 1, name = '' } = {}) {
  return createPath(rectangle(x, y, w, hgt, r), true, { fill: fill ? solid(fill) : null, stroke: stroke ? solid(stroke) : null, strokeWidth }, { name, shape: { kind: 'rect', cx: x + w / 2, cy: y + hgt / 2, w, h: hgt, radii: [r, r, r, r], angle: 0 } });
}

function oval(x, y, w, hgt, fill, { stroke = null, strokeWidth = 1, name = '' } = {}) {
  return createPath(ellipse(x, y, w, hgt), true, { fill: fill ? solid(fill) : null, stroke: stroke ? solid(stroke) : null, strokeWidth }, { name, shape: { kind: 'ellipse', cx: x + w / 2, cy: y + hgt / 2, w, h: hgt, angle: 0 } });
}

function text(str, x, y, size, color, { weight = 400, align = 'left', name = '' } = {}) {
  const t = createText(str, x, y, { name });
  return { ...t, fill: solid(color), char: { ...t.char, fontSize: size, fontWeight: weight }, para: { ...t.para, align } };
}

function line(x1, y1, x2, y2, color, width = 1) {
  return createPath(
    [
      { x: x1, y: y1, ix: x1, iy: y1, ox: x1, oy: y1 },
      { x: x2, y: y2, ix: x2, iy: y2, ox: x2, oy: y2 },
    ],
    false,
    { fill: null, stroke: solid(color), strokeWidth: width },
  );
}

/** Build a document: `fill(doc, add)` inserts nodes; history starts clean. */
function build(settings, fill) {
  const doc = VDocument.create(settings);
  doc.transact('Template', () => {
    const layerId = doc.root.children[doc.root.children.length - 1];
    const add = (node, parent = layerId) => doc.insert(node, parent);
    const addLayer = (name, extra = {}) => doc.insert({ ...createLayer(name, '#9b6bff'), ...extra }, 'root', 0);
    fill(doc, add, addLayer);
  });
  doc.undoStack.length = 0;
  doc.revision = 0;
  doc.savedRevision = 0;
  return doc;
}

export const TEMPLATES = [
  {
    id: 'business-card',
    name: 'Business Card',
    note: '3.5 x 2 in, front and back',
    width: inch(3.5),
    height: inch(2),
    build: (name) =>
      build({ name, width: inch(3.5), height: inch(2), units: 'in', artboards: 2, columns: 2, bleed: inch(0.125) }, (doc, add) => {
        const [front, back] = doc.artboards;
        const w = front.w;
        const hh = front.h;
        add(rect(front.x, front.y, w, hh, '#ffffff', { name: 'Background' }));
        add(rect(front.x, front.y, 10, hh, '#3d7bfd', { name: 'Accent bar' }));
        add(text('Alex Morgan', front.x + 24, front.y + 52, 16, '#1f1f1f', { weight: 700 }));
        add(text('Product Designer', front.x + 24, front.y + 68, 9, '#4b4b4b'));
        add(line(front.x + 24, front.y + 84, front.x + 104, front.y + 84, '#3d7bfd', 1));
        add(text('alex@example.com\n+1 555 0100\nexample.com', front.x + 24, front.y + 104, 7.5, '#4b4b4b'));
        add(rect(back.x, back.y, back.w, back.h, '#1f2a44', { name: 'Background' }));
        add(oval(back.x + back.w / 2 - 22, back.y + back.h / 2 - 34, 44, 44, '#3d7bfd', { name: 'Logo mark' }));
        add(text('STUDIO NAME', back.x + back.w / 2, back.y + back.h / 2 + 32, 10, '#ffffff', { weight: 700, align: 'center' }));
      }),
  },
  {
    id: 'poster',
    name: 'Event Poster',
    note: '18 x 24 in',
    width: inch(18),
    height: inch(24),
    build: (name) =>
      build({ name, width: inch(18), height: inch(24), units: 'in', bleed: inch(0.125) }, (doc, add) => {
        const a = doc.artboards[0];
        add(rect(a.x, a.y, a.w, a.h, '#f4efe6', { name: 'Paper' }));
        add(oval(a.x + a.w * 0.45, a.y - a.w * 0.15, a.w * 0.8, a.w * 0.8, '#ff6b4a', { name: 'Sun' }));
        add(rect(a.x + 72, a.y + a.h * 0.55, a.w - 144, 6, '#1f1f1f', { name: 'Rule' }));
        add(text('SUMMER\nSOUNDS', a.x + 72, a.y + a.h * 0.55 - 220, 150, '#1f1f1f', { weight: 800 }));
        add(text('Open-air concerts every Friday', a.x + 72, a.y + a.h * 0.55 + 72, 40, '#1f1f1f'));
        add(text('JUNE 12 - AUGUST 28', a.x + 72, a.y + a.h - 144, 48, '#ff6b4a', { weight: 700 }));
        add(text('City Park Stage  ·  Free entry', a.x + 72, a.y + a.h - 90, 28, '#4b4b4b'));
      }),
  },
  {
    id: 'social-post',
    name: 'Social Post',
    note: '1080 x 1080 px',
    width: 1080,
    height: 1080,
    build: (name) =>
      build({ name, width: 1080, height: 1080, units: 'px' }, (doc, add) => {
        const a = doc.artboards[0];
        add(rect(a.x, a.y, a.w, a.h, '#3d7bfd', { name: 'Background' }));
        add(rect(a.x + 80, a.y + 80, a.w - 160, a.h - 160, '#ffffff', { r: 48, name: 'Card' }));
        add(text('Big news', a.x + a.w / 2, a.y + 420, 120, '#1f1f1f', { weight: 800, align: 'center' }));
        add(text('Tell your audience something\nworth sharing.', a.x + a.w / 2, a.y + 540, 44, '#4b4b4b', { align: 'center' }));
        add(rect(a.x + a.w / 2 - 170, a.y + 720, 340, 96, '#1f1f1f', { r: 48, name: 'Button' }));
        add(text('Learn more', a.x + a.w / 2, a.y + 782, 36, '#ffffff', { weight: 600, align: 'center' }));
      }),
  },
  {
    id: 'web-banner',
    name: 'Web Banner',
    note: '1200 x 628 px',
    width: 1200,
    height: 628,
    build: (name) =>
      build({ name, width: 1200, height: 628, units: 'px' }, (doc, add) => {
        const a = doc.artboards[0];
        add(rect(a.x, a.y, a.w, a.h, '#101828', { name: 'Background' }));
        add(oval(a.x + a.w - 420, a.y + 80, 520, 520, '#30a46c', { name: 'Shape' }));
        add(text('Launch faster', a.x + 72, a.y + 270, 84, '#ffffff', { weight: 800 }));
        add(text('Design, review and ship in one place.', a.x + 72, a.y + 340, 32, '#d0d5dd'));
        add(rect(a.x + 72, a.y + 410, 260, 72, '#ffffff', { r: 36, name: 'Button' }));
        add(text('Get started', a.x + 202, a.y + 456, 28, '#101828', { weight: 600, align: 'center' }));
      }),
  },
  {
    id: 'icon-grid',
    name: 'Icon Grid',
    note: '512 x 512 px with keylines',
    width: 512,
    height: 512,
    build: (name) =>
      build({ name, width: 512, height: 512, units: 'px', grid: { spacing: 64, subdivisions: 8 } }, (doc, add, addLayer) => {
        const a = doc.artboards[0];
        const keyline = addLayer('Keylines');
        const k = (node) => add(node, keyline.id);
        const c = '#ff3fb4';
        for (let i = 1; i < 8; i++) {
          k(line(a.x + i * 64, a.y, a.x + i * 64, a.y + 512, '#e0e0e0', 1));
          k(line(a.x, a.y + i * 64, a.x + 512, a.y + i * 64, '#e0e0e0', 1));
        }
        k(line(a.x, a.y, a.x + 512, a.y + 512, '#e0e0e0', 1));
        k(line(a.x + 512, a.y, a.x, a.y + 512, '#e0e0e0', 1));
        k(oval(a.x + 32, a.y + 32, 448, 448, null, { stroke: c, strokeWidth: 2, name: 'Circle keyline' }));
        k(rect(a.x + 64, a.y + 64, 384, 384, null, { stroke: c, strokeWidth: 2, r: 32, name: 'Square keyline' }));
        k(rect(a.x + 96, a.y + 40, 320, 432, null, { stroke: c, strokeWidth: 2, r: 32, name: 'Portrait keyline' }));
        k(rect(a.x + 40, a.y + 96, 432, 320, null, { stroke: c, strokeWidth: 2, r: 32, name: 'Landscape keyline' }));
        k(rect(a.x + 32, a.y + 32, 448, 448, null, { stroke: '#3d7bfd', strokeWidth: 1, name: 'Safe area' }));
        doc.update(keyline.id, { locked: true, template: true });
        doc.updateRoot({ guides: [32, 256, 480].flatMap((p) => [{ axis: 'x', pos: a.x + p }, { axis: 'y', pos: a.y + p }]) });
      }),
  },
];

/** Thumbnail of a template layout (just the page shape; the cards carry the name). */
function templateThumb(t) {
  if (t.thumb) return h('span.newdoc-thumb', { 'aria-hidden': 'true' }, h('img.newdoc-page.template', { src: t.thumb, alt: '', style: { maxWidth: '64px', maxHeight: '64px' } }));
  const max = 64;
  const s = max / Math.max(t.width, t.height);
  return h('span.newdoc-thumb', { 'aria-hidden': 'true' }, h('span.newdoc-page.template', { style: { width: `${t.width * s}px`, height: `${t.height * s}px` } }, icon(t.id === 'icon-grid' ? 'grid' : t.id === 'business-card' ? 'user' : t.id === 'poster' ? 'image' : t.id === 'social-post' ? 'message-square' : 'panels-top-left', 18)));
}

export async function newFromTemplate(app) {
  // Templates the user saved (File > Save as Template) follow the built-in ones.
  const mine = ((await app.userTemplates?.list().catch(() => [])) || []).map((t) => ({ ...t, user: true, note: `My template, ${t.artboards > 1 ? `${t.artboards} artboards` : `${Math.round(t.width)} x ${Math.round(t.height)} pt`}` }));
  const all = [...TEMPLATES, ...mine];
  let chosen = all[0];
  const cards = all.map((t, i) => {
    const card = h(
      'div.newdoc-card',
      { role: 'option', tabindex: i === 0 ? '0' : '-1', 'aria-selected': String(i === 0), 'aria-label': `${t.name}, ${t.note}` },
      templateThumb(t),
      h('span.newdoc-card-name', t.name),
      ' ',
      h('span.newdoc-card-size', t.note),
    );
    card._t = t;
    return card;
  });
  const select = (card, focus) => {
    for (const c of cards) {
      c.setAttribute('aria-selected', String(c === card));
      c.tabIndex = c === card ? 0 : -1;
    }
    chosen = card._t;
    if (focus) card.focus();
  };
  const grid = h('div.newdoc-grid.templates', { role: 'listbox', 'aria-label': 'Templates' }, cards);
  let closeWith = null;
  for (const c of cards) {
    c.addEventListener('click', () => select(c));
    c.addEventListener('dblclick', () => {
      select(c);
      closeWith?.(c._t);
    });
  }
  grid.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    select(cards[Math.max(0, Math.min(cards.length - 1, i + step))], true);
  });
  const t = await openDialog({
    title: 'New from Template',
    className: 'wide newdoc-dialog',
    body: h('div.newdoc-templates', h('p.dialog-message', 'Start from an editable layout. Everything is made of regular shapes and type.'), grid),
    initialFocus: () => cards[0],
    onOpen: ({ close }) => {
      closeWith = close;
    },
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'New', primary: true, value: () => chosen },
    ],
  });
  if (!t) return null;
  const doc = t.user ? await app.userTemplates.load(t.id, takeUntitledName(app)) : t.build(takeUntitledName(app));
  return app.addDocument(doc);
}
