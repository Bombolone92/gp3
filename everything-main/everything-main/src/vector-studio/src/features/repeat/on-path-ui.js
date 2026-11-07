/**
 * Objects on Path commands, the options dialog (with live preview), the
 * Properties panel section and the start-offset handle on the canvas.
 */
import { h } from '../../lib/dom.js';
import { numberField, segmented } from '../../ui/widgets.js';
import { PropertiesPanel } from '../../ui/panels/properties.js';
import { canvasWidgets } from '../../tools/widgets.js';
import { overlayHooks } from '../../render/overlay.js';
import { expandLive } from '../../model/live.js';
import { attachToPath, releaseOnPath, pickPath, isOnPath, onPathSampler, ON_PATH_DEFAULTS } from './on-path.js';

const SPACING = [
  { value: 'even', label: 'Even' },
  { value: 'distance', label: 'Fixed distance' },
];
const ALIGN = [
  { value: 'center', label: 'Centered on the path', text: 'Center' },
  { value: 'above', label: 'Above the path', text: 'Above' },
  { value: 'below', label: 'Below the path', text: 'Below' },
];

/** Objects-on-path groups in or above the selection (or isolated). */
export function selectedOnPath(editor) {
  if (!editor) return [];
  const out = new Set();
  for (const id of editor.topSelection()) {
    let n = editor.doc.get(id);
    while (n && !isOnPath(n)) n = n.parent ? editor.doc.get(n.parent) : null;
    if (n) out.add(n.id);
  }
  if (!out.size && editor.isolation && isOnPath(editor.doc.get(editor.isolation))) out.add(editor.isolation);
  return [...out];
}

function defaults(app) {
  return { ...ON_PATH_DEFAULTS, ...(app.prefs.get('onPathOptions') || {}) };
}

const OPTION_KEYS = ['spacing', 'distance', 'align', 'rotate', 'angle', 'offset', 'reverse'];
const pick = (o) => Object.fromEntries(OPTION_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** Controls shared by the dialog and the Properties section. */
function onPathControls({ unit = 'pt', onChange }) {
  const send = (patch, o) => onChange(patch, { live: Boolean(o?.live) });
  const spacing = segmented('Spacing', SPACING.map((s) => ({ ...s, text: s.label })), 'even', (v) => send({ spacing: v }));
  const distance = numberField({ label: 'Distance between objects', icon: 'spacing-h', value: 36, unit, min: 0.01, onCommit: (v, o) => send({ distance: v }, o) });
  const align = segmented('Alignment to the path', ALIGN, 'center', (v) => send({ align: v }));
  const angle = numberField({ label: 'Turn objects by', icon: 'repeat-start', kind: 'angle', value: 0, min: -360, max: 360, onCommit: (v, o) => send({ angle: v }, o) });
  const offset = numberField({ label: 'Start offset', icon: 'path-offset', kind: 'percent', value: 0, min: 0, max: 100, onCommit: (v, o) => send({ offset: v / 100 }, o) });
  const uid = Math.random().toString(36).slice(2, 7);
  const rot = h('input', { type: 'checkbox', id: `oop-rot-${uid}`, onchange: () => send({ rotate: rot.checked }) });
  const rev = h('input', { type: 'checkbox', id: `oop-rev-${uid}`, onchange: () => send({ reverse: rev.checked }) });
  const el = h(
    'div.rep-controls',
    h('div.rep-row', h('span.rep-label', 'Spacing'), spacing.el),
    h('div.rep-grid', offset.el, angle.el, distance.el),
    h('div.rep-row', h('span.rep-label', 'Alignment'), align.el),
    h('div.check-row', rot, h('label', { for: rot.id }, 'Rotate with the path')),
    h('div.check-row', rev, h('label', { for: rev.id }, 'Reverse direction')),
  );
  return {
    el,
    set(v) {
      spacing.set(v.spacing);
      distance.set(v.distance);
      distance.el.hidden = v.spacing !== 'distance';
      align.set(v.align);
      offset.set((v.offset || 0) * 100);
      angle.set(v.angle || 0);
      rot.checked = Boolean(v.rotate);
      rev.checked = Boolean(v.reverse);
    },
    setUnit: (u) => distance.setUnit(u),
  };
}

/**
 * Attach... (no group selected) or Options...: a dialog with live preview.
 * Attaching creates the group first, inside the dialog's transaction, so
 * Cancel removes it again and OK is one undo step.
 */
async function onPathDialog(app, { attach = false } = {}) {
  const ed = app.editor;
  const doc = ed?.doc;
  let ids = attach ? [] : selectedOnPath(ed);
  let state = ids.length ? { ...ON_PATH_DEFAULTS, ...pick(doc.get(ids[0]).live) } : defaults(app);
  let tx = null;
  const pathId = attach ? pickPath(doc, ed.topSelection(), app.alignKey) : null;
  if (attach && !pathId) {
    app.notify('Select a path and the objects to place along it.');
    return false;
  }
  const sel = attach ? ed.topSelection() : null;
  const prevId = 'oop-preview';
  const preview = h('input', { type: 'checkbox', id: prevId, checked: true, onchange: () => run() });
  const run = () => {
    if (!attach && !ids.length) return;
    if (tx) tx.cancel();
    tx = null;
    if (!preview.checked) return;
    tx = doc.begin(attach ? 'Attach to Path' : 'Objects on Path Options');
    if (attach) {
      const gid = attachToPath(doc, sel, pathId, state);
      ids = gid ? [gid] : [];
    } else for (const id of ids) doc.update(id, { live: { ...doc.get(id).live, ...state } });
  };
  const controls = onPathControls({
    unit: doc?.root.units || 'pt',
    onChange: (patch) => {
      state = { ...state, ...patch };
      controls.set(state);
      run();
    },
  });
  controls.set(state);
  run();
  const body = h(
    'div.form.rep-dialog.oop-dialog',
    controls.el,
    attach || ids.length ? h('div.form-row.check', preview, h('label', { for: prevId }, 'Preview')) : h('p.form-help', 'No objects on a path are selected: these options apply when you attach objects.'),
  );
  const ok = await app.dialogs.open({
    title: attach ? 'Attach Objects to Path' : 'Objects on Path Options',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: attach ? 'Attach' : 'OK', primary: true, value: () => (body.querySelectorAll('input.num-input').forEach((i) => i.dispatchEvent(new Event('blur'))), true) },
    ],
  });
  if (tx) tx.cancel();
  tx = null;
  if (!ok) return false;
  app.prefs.set('onPathOptions', pick(state));
  let out = [];
  if (attach) {
    doc.transact('Attach to Path', () => {
      const gid = attachToPath(doc, sel, pathId, state);
      if (gid) out = [gid];
    });
    ed.select(out);
  } else if (ids.length) doc.transact('Objects on Path Options', () => ids.forEach((id) => doc.update(id, { live: { ...doc.get(id).live, ...state } })));
  return true;
}

function singleOnPath(editor) {
  const top = editor?.topSelection() || [];
  if (top.length !== 1) return null;
  const n = editor.doc.get(top[0]);
  return isOnPath(n) ? n : null;
}

function onPathSection(app) {
  return {
    id: 'onPath',
    title: 'Objects on Path',
    when: (ed) => Boolean(singleOnPath(ed)),
    build() {
      let unit = 'pt';
      const controls = onPathControls({
        onChange: (patch, { live }) => {
          const ed = app.editor;
          const g = singleOnPath(ed);
          if (!g) return;
          ed.doc.transact('Objects on Path Options', () => ed.doc.update(g.id, { live: { ...g.live, ...patch } }), { coalesce: live ? `oop-${g.id}` : null });
        },
      });
      const btn = (label, cmd) => h('button.btn', { type: 'button', onclick: () => app.commands.run(cmd) }, label);
      const el = h('div.rep-section', controls.el, h('div.quick-actions.rep-actions', btn('Edit Objects', 'objectsOnPath.edit'), btn('Release', 'objectsOnPath.release'), btn('Expand', 'objectsOnPath.expand')));
      return {
        el,
        refresh() {
          const ed = app.editor;
          const g = singleOnPath(ed);
          if (!g) return;
          if (ed.doc.root.units !== unit) controls.setUnit((unit = ed.doc.root.units));
          controls.set({ ...ON_PATH_DEFAULTS, ...g.live });
        },
      };
    },
  };
}

// ---- start offset handle ----

function offsetHandle(editor) {
  const top = editor.topSelection();
  const g = top.length === 1 ? editor.doc.get(top[0]) : editor.isolation ? editor.doc.get(editor.isolation) : null;
  if (!isOnPath(g) || editor.doc.isLocked(g.id)) return null;
  const sampler = onPathSampler(editor.doc, g);
  if (!sampler || !sampler.length) return null;
  const p = sampler.at((g.live.offset || 0) * sampler.length);
  const s = editor.view.toScreen(p.x, p.y);
  return { g, sampler, x: s.x, y: s.y, angle: p.angle };
}

function installOffsetWidget(app) {
  canvasWidgets.add({
    hit(editor, e) {
      const hnd = offsetHandle(editor);
      if (!hnd || Math.hypot(e.sx - hnd.x, e.sy - hnd.y) > 8) return null;
      return {
        id: 'onPath:offset',
        cursor: 'grab',
        tip: 'Drag along the path to move where the objects start',
        begin: () => {
          const doc = editor.doc;
          const tx = doc.begin('Objects on Path Offset');
          const L0 = hnd.g.live;
          return {
            move: (ev) => {
              const near = hnd.sampler.nearest(ev.x, ev.y);
              let offset = hnd.sampler.length ? near.s / hnd.sampler.length : 0;
              if (!hnd.sampler.closed && offset > 0.999) offset = 0.999;
              doc.update(hnd.g.id, { live: { ...L0, offset } });
              editor.feedback = { sx: ev.sx, sy: ev.sy, text: `Offset: ${Number((offset * 100).toFixed(1))}%` };
            },
            end: () => {
              editor.feedback = null;
              tx.commit();
            },
            cancel: () => {
              editor.feedback = null;
              tx.cancel();
            },
          };
        },
      };
    },
  });
  overlayHooks.add((ctx, editor, colors) => {
    if (editor.tool?.id !== 'selection') return;
    const hnd = offsetHandle(editor);
    if (!hnd) return;
    const hot = editor.widgetHover === 'onPath:offset';
    const accent = colors.selection || '#4f80ff';
    ctx.save();
    ctx.translate(Math.round(hnd.x) + 0.5, Math.round(hnd.y) + 0.5);
    ctx.rotate(hnd.angle);
    ctx.fillStyle = hot ? accent : '#ffffff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    // A small flag pointing along the path.
    ctx.beginPath();
    ctx.moveTo(-5, -6);
    ctx.lineTo(6, 0);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

export function installObjectsOnPath(app) {
  const canAttach = (a) => {
    const ed = a.editor;
    if (!ed) return false;
    const top = ed.topSelection();
    return top.length >= 2 && Boolean(pickPath(ed.doc, top, a.alignKey));
  };
  app.commands.register([
    { id: 'objectsOnPath.attach', label: 'Attach...', enabled: canAttach, run: (a) => onPathDialog(a, { attach: true }) },
    { id: 'objectsOnPath.options', label: 'Options...', enabled: (a) => Boolean(a.editor), run: (a) => onPathDialog(a) },
    {
      id: 'objectsOnPath.expand',
      label: 'Expand',
      enabled: (a) => selectedOnPath(a.editor).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = selectedOnPath(ed);
        if (ed.isolation && ids.includes(ed.isolation)) a.commands.run('object.exitIsolation');
        const out = [];
        ed.doc.transact('Expand Objects on Path', () => ids.forEach((id) => out.push(expandLive(ed.doc, id)?.id)));
        ed.select(out.filter(Boolean));
      },
    },
    {
      id: 'objectsOnPath.release',
      label: 'Release',
      enabled: (a) => selectedOnPath(a.editor).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = selectedOnPath(ed);
        if (ed.isolation && ids.includes(ed.isolation)) a.commands.run('object.exitIsolation');
        const out = [];
        ed.doc.transact('Release Objects on Path', () => ids.forEach((id) => out.push(...releaseOnPath(ed.doc, id))));
        ed.select(out);
      },
    },
    {
      id: 'objectsOnPath.edit',
      label: 'Edit Objects on Path',
      enabled: (a) => selectedOnPath(a.editor).length === 1,
      run: (a) => {
        const id = selectedOnPath(a.editor)[0];
        a.commands.run('object.isolate', { id });
      },
    },
  ]);
  if (!PropertiesPanel.extraSections.some((s) => s.id === 'onPath')) PropertiesPanel.extraSections.push(onPathSection(app));
  installOffsetWidget(app);
}
