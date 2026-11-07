/**
 * The plane widget: a small box drawing in a corner of the canvas whose
 * faces pick the active plane (left wall, right wall, floor) plus a button
 * for no plane. It shows while the perspective grid is visible. It is a
 * radio group: arrow keys move between planes, Enter or Space picks one.
 * Double-click it for its options (which corner it sits in).
 */
import { h, announce } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { PLANE_LABELS, DEFAULT_COLORS } from './grid-math.js';
import { gridOf } from './model.js';
import { pstate, setPState, onPState } from './state.js';

const NS = 'http://www.w3.org/2000/svg';
const ORDER = ['left', 'floor', 'right', 'none'];
const SHAPES = {
  left: 'M6 9 29 19v23L6 32z',
  right: 'M58 9 35 19v23l23-10z',
  floor: 'M32 45 58 53 32 62 6 53z',
};
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function svg(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function createPlaneWidget(app) {
  const faces = {};
  const picture = svg('svg', { viewBox: '0 0 64 64', width: '64', height: '64', class: 'persp-widget-svg' });
  for (const p of ['left', 'right', 'floor']) {
    const g = svg('g', { role: 'radio', tabindex: '-1', 'aria-label': PLANE_LABELS[p], 'data-plane': p, class: 'persp-face' });
    g.append(svg('path', { d: SHAPES[p] }));
    picture.append(g);
    faces[p] = g;
  }
  const none = svg('g', { role: 'radio', tabindex: '-1', 'aria-label': PLANE_LABELS.none, 'data-plane': 'none', class: 'persp-face persp-none' });
  none.append(svg('circle', { cx: '7', cy: '57', r: '5' }), svg('path', { d: 'M3.5 60.5 10.5 53.5' }));
  picture.append(none);
  faces.none = none;
  const hide = h('button.icon-btn.persp-widget-hide', { type: 'button', 'aria-label': 'Hide perspective grid', 'data-tip': 'Hide Grid', onclick: () => app.commands.run('perspective.show') }, icon('x', 12));
  const el = h('div.persp-widget', { role: 'radiogroup', 'aria-label': 'Active perspective plane', hidden: true }, picture, hide);

  const pick = (plane, focus = false) => {
    if (!app.editor) return;
    setPState(app.editor, { plane });
    announce(`${PLANE_LABELS[plane]} active`);
    if (focus) faces[plane].focus();
  };
  for (const [plane, g] of Object.entries(faces)) {
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pick(plane);
    });
    g.addEventListener('keydown', (e) => {
      const i = ORDER.indexOf(plane);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pick(ORDER[(i + 1) % ORDER.length], true);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pick(ORDER[(i + ORDER.length - 1) % ORDER.length], true);
      else if (e.key === 'Enter' || e.key === ' ') pick(plane, true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.persp-widget-hide')) return;
    widgetOptions(app);
  });

  const refresh = () => {
    const ed = app.editor;
    const st = ed ? pstate(ed) : null;
    el.hidden = !st?.visible;
    if (!st?.visible) return;
    const g = gridOf(ed.doc);
    const colors = { ...DEFAULT_COLORS, ...(g.colors || {}) };
    const corner = app.prefs.get('perspectiveWidgetCorner') || 'top-left';
    for (const c of CORNERS) el.classList.toggle(c, c === corner);
    for (const [plane, f] of Object.entries(faces)) {
      const on = st.plane === plane;
      f.setAttribute('aria-checked', on ? 'true' : 'false');
      f.setAttribute('tabindex', on ? '0' : '-1');
      f.classList.toggle('active', on);
      if (plane !== 'none') f.style.setProperty('--face', colors[plane]);
    }
  };
  onPState(() => refresh());
  app.on('active-editor', refresh);
  app.on('chrome', refresh);
  return { el, refresh };
}

async function widgetOptions(app) {
  const v = await app.dialogs.form({
    title: 'Plane Widget Options',
    fields: [
      {
        key: 'corner',
        label: 'Position',
        type: 'select',
        value: app.prefs.get('perspectiveWidgetCorner') || 'top-left',
        options: [
          { value: 'top-left', label: 'Top Left' },
          { value: 'top-right', label: 'Top Right' },
          { value: 'bottom-left', label: 'Bottom Left' },
          { value: 'bottom-right', label: 'Bottom Right' },
        ],
      },
    ],
  });
  if (!v) return;
  app.prefs.set('perspectiveWidgetCorner', v.corner);
  app.emit('chrome');
}
