/**
 * Envelope dialogs and the Properties panel section.
 *
 *  - Make / Reset with Warp: style, bend direction, bend and distortion
 *  - Make / Reset with Mesh: rows and columns (Reset can keep the shape)
 *  - Envelope Options: raster smoothing and shape preservation, fidelity,
 *    and what else distorts (appearance, linear gradients, pattern fills);
 *    rows and columns for a mesh envelope
 *
 * Every dialog previews live inside one open transaction; OK commits it as
 * a single undo step and Cancel rolls it back.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { numberField, segmented, selectField } from '../../ui/widgets.js';
import { WARP_STYLES, WARP_DEFAULTS, normalizeWarp } from '../../model/warp.js';
import { registerEffectIcons } from '../effects/icons.js';
import { sliderField, choiceField, checkField, numberRow, selectRow, group } from '../effects/dialog-kit.js';
import { isEnvelope, editingContents, envelopeOf, normalizeOptions, OPTION_DEFAULTS, MESH_LIMIT } from './envelope-model.js';
import { makeEnvelope, resetWithWarp, resetWithMesh, setEnvelopeOptions, setEditingContents } from './envelope-ops.js';

const pct = (v) => v * 100;
const frac = (v) => v / 100;
let uid = 0;

// ---- targets ----

/** Envelopes the commands act on: selected envelopes, or the ones whose contents hold the selection. */
export function targetEnvelopes(editor) {
  if (!editor) return [];
  const out = new Map();
  for (const id of editor.topSelection()) {
    const n = editor.doc.get(id);
    const env = isEnvelope(n) ? n : envelopeOf(editor.doc, id);
    if (env && !editor.doc.isLocked(env.id)) out.set(env.id, env);
  }
  return [...out.values()];
}

/** True when every selected object is an envelope (Make becomes Reset). */
export function resetting(editor) {
  const top = editor?.topSelection() || [];
  return top.length > 0 && top.every((id) => isEnvelope(editor.doc.get(id)));
}

/** Objects Make with Warp / Mesh would put into an envelope. */
export function makeTargets(editor) {
  if (!editor) return [];
  return editor.topSelection().filter((id) => {
    const n = editor.doc.get(id);
    return n && n.type !== 'layer' && !editor.doc.isLocked(id);
  });
}

export function envelopeDefaults(app) {
  return normalizeOptions({ ...OPTION_DEFAULTS, ...(app.prefs?.get?.('envelopeOptions') || {}) });
}

// ---- preview sessions ----

function session(app, label, apply) {
  const ed = app.editor;
  const doc = ed.doc;
  const before = [...ed.selection];
  let tx = null;
  const self = {
    on: true,
    run(values, on = self.on) {
      self.on = on;
      if (tx) tx.cancel();
      tx = null;
      if (!on) {
        ed.select(before.filter((id) => doc.has(id)));
        return;
      }
      tx = doc.begin(label);
      const ids = apply(values);
      if (ids?.length) ed.select(ids.filter((id) => doc.has(id)));
    },
    commit(values) {
      if (tx) tx.cancel();
      tx = null;
      let ids = null;
      doc.transact(label, () => {
        ids = apply(values);
      });
      ed.select((ids?.length ? ids : before).filter((id) => doc.has(id)));
      return ids;
    },
    cancel() {
      if (tx) tx.cancel();
      tx = null;
      ed.select(before.filter((id) => doc.has(id)));
    },
  };
  return self;
}

function previewToggle(app, onChange) {
  const id = `env-preview-${++uid}`;
  const box = h('input', { type: 'checkbox', id, checked: app.prefs?.get?.('effectPreview') ?? true });
  box.addEventListener('change', () => {
    app.prefs?.set?.('effectPreview', box.checked);
    onChange();
  });
  return { el: h('label.fx-preview-toggle', { for: id }, box, 'Preview'), get: () => box.checked };
}

async function runDialog(app, { title, className = '', body, read, focus, sess }) {
  const prev = previewToggle(app, () => sess.run(read(), prev.get()));
  let res = null;
  try {
    res = await openDialog({
      title,
      className: `fx-dialog env-dialog ${className}`.trim(),
      body,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'OK', primary: true, value: () => read() },
      ],
      initialFocus: focus,
      onOpen: ({ footer }) => {
        footer.prepend(prev.el);
        sess.run(read(), prev.get());
      },
    });
  } catch (err) {
    sess.cancel();
    throw err;
  }
  if (!res) {
    sess.cancel();
    return null;
  }
  sess.commit(res);
  return res;
}

// ---- warp ----

/** Warp style picker, bend direction, bend and distortion (dialog controls). */
function warpControls(start, changed) {
  registerEffectIcons();
  let style = start.style;
  const name = h('span.fx-warp-name', { 'aria-live': 'polite' });
  const buttons = WARP_STYLES.map((st) =>
    h('button.fx-warp-style', { type: 'button', role: 'radio', 'aria-label': st.label, 'data-tip': st.label, 'data-style': st.id, onclick: () => pick(st.id) }, icon(`warp-${st.id}`, 22)),
  );
  const grid = h('div.fx-warp-grid', { role: 'radiogroup', 'aria-label': 'Style' }, buttons);
  grid.addEventListener('keydown', (e) => {
    const i = WARP_STYLES.findIndex((x) => x.id === style);
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
    if (d == null) return;
    e.preventDefault();
    e.stopPropagation();
    const j = Math.max(0, Math.min(WARP_STYLES.length - 1, i + d));
    pick(WARP_STYLES[j].id);
    buttons[j].focus();
  });
  let ready = false;
  const pick = (id) => {
    style = id;
    buttons.forEach((b, i) => {
      const on = WARP_STYLES[i].id === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    name.textContent = WARP_STYLES.find((x) => x.id === id)?.label || '';
    if (ready) changed();
  };
  pick(style);
  const orient = choiceField({ label: 'Bend along', value: start.vertical ? 'vertical' : 'horizontal', options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }], onChange: changed });
  const bend = sliderField({ label: 'Bend', value: pct(start.bend), min: -100, max: 100, kind: 'percent', onInput: changed });
  const dh = sliderField({ label: 'Horizontal', value: pct(start.distortH), min: -100, max: 100, kind: 'percent', onInput: changed });
  const dv = sliderField({ label: 'Vertical', value: pct(start.distortV), min: -100, max: 100, kind: 'percent', onInput: changed });
  ready = true;
  return {
    els: [h('div.fx-row.fx-warp-head', h('span.fx-label', 'Style'), name), grid, orient.el, bend.el, group('Distortion', dh.el, dv.el)],
    read: () => normalizeWarp({ style, vertical: orient.get() === 'vertical', bend: frac(bend.get()), distortH: frac(dh.get()), distortV: frac(dv.get()) }),
    focus: () => buttons.find((b) => b.tabIndex === 0),
  };
}

/** Object > Envelope Distort > Make (or Reset) with Warp. */
export async function warpDialog(app) {
  const ed = app.editor;
  if (!ed) return false;
  const doc = ed.doc;
  const reset = resetting(ed);
  const envs = reset ? targetEnvelopes(ed) : [];
  const ids = reset ? [] : makeTargets(ed);
  if (!envs.length && !ids.length) {
    app.notify('Select the objects to distort.');
    return false;
  }
  const first = envs[0];
  const start = normalizeWarp(first?.live.mode === 'warp' ? first.live.warp : { ...WARP_DEFAULTS, ...(app.prefs?.get?.('envelopeWarp') || {}) });
  const label = reset ? 'Reset with Warp' : 'Make with Warp';
  const sess = session(app, label, (warp) => {
    if (reset) {
      for (const env of envs) resetWithWarp(doc, env.id, warp);
      return envs.map((e) => e.id);
    }
    const id = makeEnvelope(doc, ids, { mode: 'warp', warp, options: envelopeDefaults(app) });
    return id ? [id] : null;
  });
  const controls = warpControls(start, () => sess.run(controls.read()));
  const res = await runDialog(app, {
    title: label,
    className: 'fx-warp',
    body: h('div.fx-body', ...controls.els),
    read: () => controls.read(),
    focus: controls.focus,
    sess,
  });
  if (!res) return false;
  app.prefs?.set?.('envelopeWarp', res);
  return true;
}

// ---- mesh ----

/** Object > Envelope Distort > Make (or Reset) with Mesh. */
export async function meshDialog(app) {
  const ed = app.editor;
  if (!ed) return false;
  const doc = ed.doc;
  const reset = resetting(ed);
  const envs = reset ? targetEnvelopes(ed) : [];
  const ids = reset ? [] : makeTargets(ed);
  if (!envs.length && !ids.length) {
    app.notify('Select the objects to distort.');
    return false;
  }
  const saved = app.prefs?.get?.('envelopeMesh') || {};
  const own = envs[0]?.live.mode === 'mesh' ? envs[0].live.mesh : null;
  const label = reset ? 'Reset with Mesh' : 'Make with Mesh';
  const sess = session(app, label, (v) => {
    if (reset) {
      for (const env of envs) resetWithMesh(doc, env.id, v.rows, v.cols, { maintain: v.maintain });
      return envs.map((e) => e.id);
    }
    const id = makeEnvelope(doc, ids, { mode: 'mesh', rows: v.rows, cols: v.cols, options: envelopeDefaults(app) });
    return id ? [id] : null;
  });
  const changed = () => sess.run(read());
  const rows = numberRow({ label: 'Rows', value: own?.rows ?? saved.rows ?? 4, min: 1, max: MESH_LIMIT, integer: true, onInput: changed });
  const cols = numberRow({ label: 'Columns', value: own?.cols ?? saved.cols ?? 4, min: 1, max: MESH_LIMIT, integer: true, onInput: changed });
  const maintain = reset ? checkField({ label: 'Keep the envelope shape', value: saved.maintain ?? true, onChange: changed }) : null;
  const read = () => ({ rows: rows.get(), cols: cols.get(), maintain: maintain ? maintain.get() : true });
  const res = await runDialog(app, {
    title: label,
    body: h('div.fx-body', maintain?.el, group('Mesh', rows.el, cols.el)),
    read,
    focus: () => rows.field,
    sess,
  });
  if (!res) return false;
  app.prefs?.set?.('envelopeMesh', res);
  return true;
}

/** Object > Envelope Distort > Make with Top Object. */
export function makeWithTop(app) {
  const ed = app.editor;
  if (!ed) return false;
  const doc = ed.doc;
  let id = null;
  doc.transact('Make with Top Object', () => {
    id = makeEnvelope(doc, makeTargets(ed), { mode: 'top', options: envelopeDefaults(app) });
  });
  if (!id) {
    app.notify('Select a path on top of the objects to distort.');
    return false;
  }
  ed.select([id]);
  return true;
}

// ---- options ----

/** Option controls (shared by the dialog and tests). */
function optionControls(o, changed) {
  const aa = checkField({ label: 'Anti-alias', value: o.antialias, onChange: changed });
  const preserve = choiceField({ label: 'Keep shape with', value: o.preserve, options: [{ value: 'clip', label: 'Clipping mask' }, { value: 'transparency', label: 'Transparency' }], onChange: changed });
  const fidelity = sliderField({ label: 'Fidelity', value: o.fidelity, min: 0, max: 100, integer: true, onInput: changed, ends: ['Faster', 'Smoother'] });
  const appearance = checkField({ label: 'Distort appearance', value: o.distortAppearance, onChange: changed });
  const gradients = checkField({ label: 'Distort linear gradients', value: o.distortGradients, onChange: changed });
  const patterns = checkField({ label: 'Distort pattern fills', value: o.distortPatterns, onChange: changed });
  return {
    els: [group('Images', aa.el, preserve.el), fidelity.el, group('Distort', appearance.el, gradients.el, patterns.el)],
    read: () => normalizeOptions({ antialias: aa.get(), preserve: preserve.get(), fidelity: fidelity.get(), distortAppearance: appearance.get(), distortGradients: gradients.get(), distortPatterns: patterns.get() }),
    focus: () => fidelity.field,
  };
}

/** Warp settings as plain rows (the Options dialog edits a warp envelope's warp too). */
function compactWarp(w, changed) {
  const style = selectRow({ label: 'Style', value: w.style, options: WARP_STYLES.map((x) => ({ value: x.id, label: x.label })), onChange: changed });
  const orient = choiceField({ label: 'Bend along', value: w.vertical ? 'vertical' : 'horizontal', options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }], onChange: changed });
  const bend = sliderField({ label: 'Bend', value: pct(w.bend), min: -100, max: 100, kind: 'percent', onInput: changed });
  const dh = sliderField({ label: 'Distort horizontally', value: pct(w.distortH), min: -100, max: 100, kind: 'percent', onInput: changed });
  const dv = sliderField({ label: 'Distort vertically', value: pct(w.distortV), min: -100, max: 100, kind: 'percent', onInput: changed });
  return {
    els: [style.el, orient.el, bend.el, dh.el, dv.el],
    read: () => normalizeWarp({ style: style.get(), vertical: orient.get() === 'vertical', bend: frac(bend.get()), distortH: frac(dh.get()), distortV: frac(dv.get()) }),
  };
}

/**
 * Envelope Options: edits the selected envelopes (with a live preview) or,
 * with none selected, the options new envelopes get.
 */
export async function optionsDialog(app) {
  const ed = app.editor;
  const envs = targetEnvelopes(ed);
  const doc = ed?.doc;
  const start = envs.length ? normalizeOptions(envs[0].live.options) : envelopeDefaults(app);
  const mesh = envs.length === 1 && envs[0].live.mode === 'mesh' ? envs[0].live.mesh : null;
  const warp = envs.length === 1 && envs[0].live.mode === 'warp' ? normalizeWarp(envs[0].live.warp) : null;
  let controls = null;
  let rows = null;
  let cols = null;
  let warpRows = null;
  const read = () => ({ options: controls.read(), rows: rows?.get(), cols: cols?.get(), warp: warpRows?.read() });
  const sess = envs.length
    ? session(app, 'Envelope Options', (v) => {
        for (const env of envs) {
          setEnvelopeOptions(doc, env.id, v.options);
          if (rows && (v.rows !== mesh.rows || v.cols !== mesh.cols)) resetWithMesh(doc, env.id, v.rows, v.cols, { maintain: true });
          if (v.warp) resetWithWarp(doc, env.id, v.warp);
        }
        return envs.map((e) => e.id);
      })
    : { run() {}, commit() {}, cancel() {} };
  const changed = () => controls && sess.run(read());
  controls = optionControls(start, changed);
  if (mesh) {
    rows = numberRow({ label: 'Rows', value: mesh.rows, min: 1, max: MESH_LIMIT, integer: true, onInput: changed });
    cols = numberRow({ label: 'Columns', value: mesh.cols, min: 1, max: MESH_LIMIT, integer: true, onInput: changed });
  }
  if (warp) warpRows = compactWarp(warp, changed);
  const note = envs.length ? null : h('p.fx-note', 'No envelope is selected: these options apply to new envelopes.');
  const res = await runDialog(app, {
    title: 'Envelope Options',
    body: h('div.fx-body', note, ...controls.els, mesh ? group('Mesh', rows.el, cols.el) : null, warp ? group('Warp', ...warpRows.els) : null),
    read,
    focus: controls.focus,
    sess,
  });
  if (!res) return false;
  if (!envs.length) app.prefs?.set?.('envelopeOptions', res.options);
  return true;
}

// ---- Edit Contents ----

/** Toggle between editing the envelopes and editing their contents. */
export function toggleEditContents(app, { on = null } = {}) {
  const ed = app.editor;
  const envs = targetEnvelopes(ed);
  if (!envs.length) return false;
  const next = on ?? !envs.every(editingContents);
  ed.doc.transact(next ? 'Edit Contents' : 'Edit Envelope', () => {
    for (const env of envs) setEditingContents(ed.doc, env.id, next);
  });
  ed.select(envs.map((e) => e.id));
  app.notify(next ? 'Editing the envelope contents' : 'Editing the envelope', { polite: true });
  return true;
}

// ---- Properties panel ----

function singleEnvelope(ed) {
  const envs = targetEnvelopes(ed);
  return envs.length === 1 ? envs[0] : null;
}

/** Apply a change to the single target envelope (slider scrubs coalesce into one step). */
function edit(app, label, fn, live = false) {
  const ed = app.editor;
  const env = singleEnvelope(ed);
  if (!env) return;
  ed.doc.transact(label, () => fn(ed.doc, env), { coalesce: live ? `envelope-${env.id}-${label}` : null });
}

export function envelopeSection() {
  return {
    id: 'envelope',
    title: 'Envelope',
    when: (ed) => Boolean(singleEnvelope(ed)),
    build(app) {
      const editing = segmented(
        'Edit',
        [
          { value: 'envelope', text: 'Envelope' },
          { value: 'contents', text: 'Contents' },
        ],
        'envelope',
        (v) => toggleEditContents(app, { on: v === 'contents' }),
      );
      editing.el.classList.add('env-edit-toggle');
      const mode = selectField(
        'Envelope type',
        [
          { value: 'warp', label: 'Warp' },
          { value: 'mesh', label: 'Mesh' },
        ],
        'warp',
        (v) =>
          edit(app, v === 'mesh' ? 'Reset with Mesh' : 'Reset with Warp', (doc, env) => {
            if (v === 'mesh') {
              const g = app.prefs?.get?.('envelopeMesh') || {};
              resetWithMesh(doc, env.id, g.rows ?? 4, g.cols ?? 4, { maintain: true });
            } else resetWithWarp(doc, env.id, { ...WARP_DEFAULTS, ...(app.prefs?.get?.('envelopeWarp') || {}) });
          }),
      );
      const style = selectField(
        'Warp style',
        WARP_STYLES.map((s) => ({ value: s.id, label: s.label })),
        'arc',
        (v) => edit(app, 'Warp Style', (doc, env) => resetWithWarp(doc, env.id, { ...env.live.warp, style: v })),
      );
      const orient = segmented(
        'Bend along',
        [
          { value: 'horizontal', text: 'Horizontal' },
          { value: 'vertical', text: 'Vertical' },
        ],
        'horizontal',
        (v) => edit(app, 'Warp Direction', (doc, env) => resetWithWarp(doc, env.id, { ...env.live.warp, vertical: v === 'vertical' })),
      );
      const warpField = (label, key, short) =>
        numberField({
          label: short,
          ariaLabel: label,
          kind: 'percent',
          value: 0,
          min: -100,
          max: 100,
          width: '64px',
          onCommit: (v, o) => edit(app, `Warp ${label}`, (doc, env) => resetWithWarp(doc, env.id, { ...env.live.warp, [key]: frac(v) }), Boolean(o?.live)),
        });
      const bend = warpField('Bend', 'bend', 'Bend');
      const dh = warpField('Horizontal distortion', 'distortH', 'H');
      const dv = warpField('Vertical distortion', 'distortV', 'V');
      const meshField = (label, key) =>
        numberField({
          label,
          kind: 'number',
          value: 4,
          min: 1,
          max: MESH_LIMIT,
          width: '56px',
          digits: 0,
          onCommit: (v, o) =>
            edit(app, 'Envelope Mesh', (doc, env) => {
              const m = env.live.mesh;
              const next = { rows: m.rows, cols: m.cols, [key]: Math.round(v) };
              resetWithMesh(doc, env.id, next.rows, next.cols, { maintain: true });
            }, Boolean(o?.live)),
        });
      const rows = meshField('Rows', 'rows');
      const cols = meshField('Columns', 'cols');
      const warpBox = h(
        'div.env-props-group',
        h('div.env-props-row', h('span.env-props-label', 'Style'), style.el),
        h('div.env-props-row', h('span.env-props-label', 'Bend along'), orient.el),
        h('div.env-props-row', bend.el),
        h('div.env-props-row', h('span.env-props-label', 'Distortion'), dh.el, dv.el),
      );
      const meshBox = h('div.env-props-group', h('div.env-props-row', rows.el, cols.el));
      const btn = (label, cmd) => h('button.btn.small', { type: 'button', onclick: () => app.commands.run(cmd) }, label);
      const el = h(
        'div.env-props',
        h('div.env-props-row', h('span.env-props-label', 'Edit'), editing.el),
        h('div.env-props-row', h('span.env-props-label', 'Type'), mode.el),
        warpBox,
        meshBox,
        h('div.quick-actions.env-props-actions', btn('Options…', 'envelope.options'), btn('Release', 'envelope.release'), btn('Expand', 'envelope.expand')),
      );
      return {
        el,
        refresh() {
          const env = singleEnvelope(app.editor);
          if (!env) return;
          const L = env.live;
          editing.set(editingContents(env) ? 'contents' : 'envelope');
          mode.set(L.mode);
          warpBox.hidden = L.mode !== 'warp';
          meshBox.hidden = L.mode !== 'mesh';
          if (L.mode === 'warp') {
            const w = normalizeWarp(L.warp);
            style.set(w.style);
            orient.set(w.vertical ? 'vertical' : 'horizontal');
            bend.set(pct(w.bend));
            dh.set(pct(w.distortH));
            dv.set(pct(w.distortV));
          } else if (L.mesh) {
            rows.set(L.mesh.rows);
            cols.set(L.mesh.cols);
          }
        },
      };
    },
  };
}
