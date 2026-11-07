/**
 * Repeat controls: the Properties panel section for a selected repeat and
 * the Repeat Options dialog. Both edit the same values through one control
 * set: instances, radius, start angle, span and overlap for radial
 * repeats; spacing, columns, rows, grid type and alternate flips for
 * grids; the axis angle for mirrors.
 *
 * Angles shown here are counterclockwise-positive like the rest of the
 * app: a radial start angle of 0° puts the source at the top, and a
 * vertical mirror axis is 90°.
 */
import { h } from '../../lib/dom.js';
import { numberField, segmented, iconButton } from '../../ui/widgets.js';
import { isRepeat, radialGeometry, setRepeatParams, setRepeatMode, REPEAT_DEFAULTS, MAX_INSTANCES, MAX_GRID } from './repeat-model.js';

const norm180 = (d) => {
  let v = ((d % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return Math.abs(v) < 1e-9 ? 0 : v;
};

/** Start angle as shown (0 = top, counterclockwise positive) from a screen angle. */
export const shownStartAngle = (screenDeg) => norm180(-(screenDeg + 90));
/** Screen angle (clockwise from +x) from a shown start angle. */
export const screenStartAngle = (shown) => -shown - 90;

/** Flat values the controls show for a repeat. */
export function repeatValues(doc, g) {
  const L = g.live;
  if (L.mode === 'radial') {
    const geo = radialGeometry(doc, g);
    return { mode: 'radial', count: L.count, radius: geo.radius, angle: shownStartAngle(geo.angle), span: L.span ?? 360, reverse: Boolean(L.reverse) };
  }
  if (L.mode === 'grid') {
    const o = { ...REPEAT_DEFAULTS.grid, ...L };
    return { mode: 'grid', cols: o.cols, rows: o.rows, hSpacing: o.hSpacing, vSpacing: o.vSpacing, gridType: o.gridType, flipRowH: o.flipRowH, flipRowV: o.flipRowV, flipColH: o.flipColH, flipColV: o.flipColV };
  }
  const deg = (Math.atan2(L.y2 - L.y1, L.x2 - L.x1) * 180) / Math.PI;
  let shown = ((-deg % 180) + 180) % 180;
  if (Math.abs(shown - 180) < 1e-9) shown = 0;
  return { mode: 'mirror', axisAngle: shown };
}

/** Apply shown values (any subset) to a repeat (inside a transaction). */
export function applyRepeatValues(doc, id, v) {
  const g = doc.get(id);
  if (!isRepeat(g)) return;
  if (v.mode && v.mode !== g.live.mode) setRepeatMode(doc, id, v.mode, v);
  const L = doc.get(id).live;
  const patch = {};
  if (L.mode === 'radial') {
    if (v.count !== undefined) patch.count = Math.max(1, Math.min(MAX_INSTANCES, Math.round(v.count)));
    if (v.span !== undefined) patch.span = Math.max(1, Math.min(360, v.span));
    if (v.reverse !== undefined) patch.reverse = Boolean(v.reverse);
    // Radius and start angle move the source: only when they really change.
    const geo = radialGeometry(doc, doc.get(id));
    if (v.radius !== undefined && Math.abs(Math.max(0, v.radius) - geo.radius) > 1e-6) patch.radius = Math.max(0, v.radius);
    if (v.angle !== undefined && Math.abs(norm180(v.angle - shownStartAngle(geo.angle))) > 1e-6) patch.angle = screenStartAngle(v.angle);
  } else if (L.mode === 'grid') {
    for (const k of ['hSpacing', 'vSpacing', 'gridType', 'flipRowH', 'flipRowV', 'flipColH', 'flipColV']) if (v[k] !== undefined) patch[k] = v[k];
    if (v.cols !== undefined) patch.cols = Math.max(1, Math.min(MAX_GRID, Math.round(v.cols)));
    if (v.rows !== undefined) patch.rows = Math.max(1, Math.min(MAX_GRID, Math.round(v.rows)));
  } else if (L.mode === 'mirror' && v.axisAngle !== undefined) {
    const mx = (L.x1 + L.x2) / 2;
    const my = (L.y1 + L.y2) / 2;
    const half = Math.hypot(L.x2 - L.x1, L.y2 - L.y1) / 2 || 50;
    const a = (-v.axisAngle * Math.PI) / 180;
    const dx = Math.cos(a) * half;
    const dy = Math.sin(a) * half;
    Object.assign(patch, { x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy });
  }
  if (Object.keys(patch).length) setRepeatParams(doc, id, patch);
}

export const MODE_OPTIONS = [
  { value: 'radial', label: 'Radial', icon: 'repeat-radial' },
  { value: 'grid', label: 'Grid', icon: 'repeat-grid' },
  { value: 'mirror', label: 'Mirror', icon: 'repeat-mirror' },
];

const GRID_TYPES = [
  { value: 'grid', label: 'Grid', icon: 'grid-type-grid' },
  { value: 'brickRow', label: 'Brick by Row', icon: 'grid-type-brick-row' },
  { value: 'brickCol', label: 'Brick by Column', icon: 'grid-type-brick-col' },
];

/**
 * The control set. `onChange(patch, { live })` gets shown values; `live`
 * marks a scrub that will be followed by more changes. `showRadius`
 * false hides fields that only make sense for an existing repeat.
 */
export function repeatControls({ unit = 'pt', onChange, showMode = true, showGeometry = true }) {
  let cur = { mode: 'radial' };
  const send = (patch, o) => onChange({ ...patch }, { live: Boolean(o?.live) });
  const mode = segmented('Repeat type', MODE_OPTIONS, 'radial', (v) => {
    if (v === cur.mode) return;
    send({ mode: v });
  });
  // Radial.
  const count = numberField({ label: 'Instances', icon: 'repeat-instances', kind: 'number', value: 8, min: 1, max: MAX_INSTANCES, onCommit: (v, o) => send({ count: Math.round(v) }, o) });
  const radius = numberField({ label: 'Radius', icon: 'repeat-radius', value: 50, unit, min: 0, onCommit: (v, o) => send({ radius: v }, o) });
  const angle = numberField({ label: 'Start angle', icon: 'repeat-start', kind: 'angle', value: 0, onCommit: (v, o) => send({ angle: v }, o) });
  const span = numberField({ label: 'Angle span', icon: 'repeat-span', kind: 'angle', value: 360, min: 1, max: 360, onCommit: (v, o) => send({ span: v }, o) });
  const revId = `rep-rev-${Math.random().toString(36).slice(2, 7)}`;
  const reverse = h('input', { type: 'checkbox', id: revId, onchange: () => send({ reverse: reverse.checked }) });
  const radial = h('div.rep-body', h('div.rep-grid', count.el, radius.el, showGeometry ? angle.el : null, span.el), h('div.check-row', reverse, h('label', { for: revId }, 'Reverse overlap')));
  if (!showGeometry) radius.el.hidden = true;
  // Grid.
  const hs = numberField({ label: 'Horizontal spacing', icon: 'spacing-h', value: 10, unit, onCommit: (v, o) => send({ hSpacing: v }, o) });
  const vs = numberField({ label: 'Vertical spacing', icon: 'spacing-v', value: 10, unit, onCommit: (v, o) => send({ vSpacing: v }, o) });
  const cols = numberField({ label: 'Columns', icon: 'grid-cols', kind: 'number', value: 3, min: 1, max: MAX_GRID, onCommit: (v, o) => send({ cols: Math.round(v) }, o) });
  const rows = numberField({ label: 'Rows', icon: 'grid-rows', kind: 'number', value: 3, min: 1, max: MAX_GRID, onCommit: (v, o) => send({ rows: Math.round(v) }, o) });
  const type = segmented('Grid type', GRID_TYPES, 'grid', (v) => send({ gridType: v }));
  const toggle = (key, ic, label) => {
    const b = iconButton(ic, label, () => send({ [key]: b.getAttribute('aria-pressed') !== 'true' }), { pressed: false });
    b.dataset.key = key;
    return b;
  };
  const flips = [toggle('flipRowH', 'flip-h', 'Flip alternate rows horizontally'), toggle('flipRowV', 'flip-v', 'Flip alternate rows vertically'), toggle('flipColH', 'flip-h', 'Flip alternate columns horizontally'), toggle('flipColV', 'flip-v', 'Flip alternate columns vertically')];
  const grid = h(
    'div.rep-body',
    h('div.rep-grid', hs.el, vs.el, cols.el, rows.el),
    h('div.rep-row', h('span.rep-label', 'Grid type'), type.el),
    h('div.rep-row', h('span.rep-label', 'Flip rows'), h('div.toggle-row', flips[0], flips[1])),
    h('div.rep-row', h('span.rep-label', 'Flip columns'), h('div.toggle-row', flips[2], flips[3])),
  );
  // Mirror.
  const axis = numberField({ label: 'Axis angle', icon: 'repeat-axis', kind: 'angle', value: 90, onCommit: (v, o) => send({ axisAngle: v }, o) });
  const mirror = h('div.rep-body', h('div.rep-grid', axis.el));
  const bodies = { radial, grid, mirror };
  const el = h('div.rep-controls', showMode ? h('div.rep-row', h('span.rep-label', 'Type'), mode.el) : null, radial, grid, mirror);
  const set = (v) => {
    cur = { ...v };
    mode.set(v.mode);
    for (const [k, b] of Object.entries(bodies)) b.hidden = k !== v.mode;
    if (v.mode === 'radial') {
      count.set(v.count);
      radius.set(v.radius);
      angle.set(v.angle);
      span.set(v.span);
      reverse.checked = Boolean(v.reverse);
    } else if (v.mode === 'grid') {
      hs.set(v.hSpacing);
      vs.set(v.vSpacing);
      cols.set(v.cols);
      rows.set(v.rows);
      type.set(v.gridType);
      for (const b of flips) b.setAttribute('aria-pressed', String(Boolean(v[b.dataset.key])));
    } else axis.set(v.axisAngle);
  };
  const setUnit = (u) => [radius, hs, vs].forEach((f) => f.setUnit(u));
  return { el, set, setUnit };
}

/** Repeats the commands act on: selected repeats or repeats above selected objects, else the isolated one. */
export function selectedRepeats(editor) {
  if (!editor) return [];
  const out = new Set();
  for (const id of editor.topSelection()) {
    let n = editor.doc.get(id);
    while (n && !isRepeat(n)) n = n.parent ? editor.doc.get(n.parent) : null;
    if (n) out.add(n.id);
  }
  if (!out.size && editor.isolation && isRepeat(editor.doc.get(editor.isolation))) out.add(editor.isolation);
  return [...out];
}

/** The single selected repeat for the Properties panel, or null. */
export function singleRepeat(editor) {
  const top = editor?.topSelection() || [];
  if (top.length !== 1) return null;
  const n = editor.doc.get(top[0]);
  return isRepeat(n) ? n : null;
}

/** Properties panel section. */
export function repeatSection(app) {
  return {
    id: 'repeat',
    title: 'Repeat Options',
    when: (ed) => Boolean(singleRepeat(ed)),
    build() {
      let unit = 'pt';
      const controls = repeatControls({
        unit,
        onChange: (patch, { live }) => {
          const ed = app.editor;
          const g = singleRepeat(ed);
          if (!g) return;
          ed.doc.transact('Repeat Options', () => applyRepeatValues(ed.doc, g.id, patch), { coalesce: live ? `repeat-${g.id}` : null });
        },
      });
      const btn = (label, cmd) => h('button.btn', { type: 'button', onclick: () => app.commands.run(cmd) }, label);
      const el = h('div.rep-section', controls.el, h('div.quick-actions.rep-actions', btn('Edit Source', 'repeat.edit'), btn('Release', 'repeat.release'), btn('Expand', 'object.expand'), btn('Options…', 'repeat.options')));
      return {
        el,
        refresh() {
          const ed = app.editor;
          const g = singleRepeat(ed);
          if (!g) return;
          if (ed.doc.root.units !== unit) {
            unit = ed.doc.root.units;
            controls.setUnit(unit);
          }
          controls.set(repeatValues(ed.doc, g));
        },
      };
    },
  };
}

/** Default options for new repeats (Repeat Options with nothing selected). */
export function repeatDefaults(app) {
  const saved = app.prefs.get('repeatOptions') || {};
  return {
    radial: { ...REPEAT_DEFAULTS.radial, ...(saved.radial || {}) },
    grid: { ...REPEAT_DEFAULTS.grid, ...(saved.grid || {}) },
    mirror: { ...(saved.mirror || {}) },
  };
}

/**
 * Repeat Options: edits the selected repeats with a live preview (one undo
 * step), or the defaults for new repeats when none is selected.
 */
export async function repeatOptionsDialog(app) {
  const ed = app.editor;
  const ids = selectedRepeats(ed);
  const doc = ed?.doc;
  const defaults = repeatDefaults(app);
  const first = ids.length ? doc.get(ids[0]) : null;
  let values = first ? repeatValues(doc, first) : { mode: 'radial', ...defaults.radial, radius: undefined, angle: 0 };
  const byMode = { radial: { ...defaults.radial, angle: 0 }, grid: { ...defaults.grid }, mirror: { axisAngle: 90 } };
  byMode[values.mode] = { ...byMode[values.mode], ...values };
  const prevId = 'rep-preview';
  const preview = h('input', { type: 'checkbox', id: prevId, checked: true, onchange: () => run() });
  let tx = null;
  const run = () => {
    if (!ids.length) return;
    if (tx) tx.cancel();
    tx = null;
    if (!preview.checked) return;
    tx = doc.begin('Repeat Options');
    for (const id of ids) applyRepeatValues(doc, id, values);
  };
  const controls = repeatControls({
    unit: doc?.root.units || 'pt',
    showGeometry: Boolean(ids.length),
    onChange: (patch) => {
      if (patch.mode && patch.mode !== values.mode) {
        byMode[values.mode] = { ...values };
        values = { ...byMode[patch.mode], mode: patch.mode };
        // A new mode takes its geometry from the source again.
        delete values.radius;
        if (patch.mode === 'radial') delete values.angle;
      } else values = { ...values, ...patch };
      run();
      if (ids.length && patch.mode) values = { ...repeatValues(doc, doc.get(ids[0])), ...values };
      controls.set(fill(values));
    },
  });
  const fill = (v) => ({ ...byMode[v.mode], radius: 0, angle: 0, axisAngle: 90, ...stripUndefined(v) });
  controls.set(fill(values));
  run();
  const body = h('div.form.rep-dialog', controls.el, ids.length ? h('div.form-row.check', preview, h('label', { for: prevId }, 'Preview')) : h('p.form-help', 'No repeat is selected: these options apply to new repeats.'));
  const ok = await app.dialogs.open({
    title: 'Repeat Options',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, value: () => (body.querySelectorAll('input.num-input').forEach((i) => i.dispatchEvent(new Event('blur'))), true) },
    ],
  });
  if (tx) tx.cancel();
  tx = null;
  if (!ok) return false;
  // Remember the settings that make sense for new repeats.
  const saved = { ...(app.prefs.get('repeatOptions') || {}) };
  const keep = { radial: ['count', 'span', 'reverse'], grid: ['cols', 'rows', 'hSpacing', 'vSpacing', 'gridType', 'flipRowH', 'flipRowV', 'flipColH', 'flipColV'], mirror: [] }[values.mode];
  saved[values.mode] = Object.fromEntries(keep.filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));
  app.prefs.set('repeatOptions', saved);
  if (ids.length) doc.transact('Repeat Options', () => ids.forEach((id) => applyRepeatValues(doc, id, values)));
  return true;
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
