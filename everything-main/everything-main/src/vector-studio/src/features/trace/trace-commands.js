/**
 * Object > Trace Image > Make / Make and Expand / Release / Expand, the
 * trace settings used for new traces, and a cancellable progress pill.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { DEFAULT_PRESET, presetOptions, normalizeOptions, matchingPreset } from './presets.js';
import { isTrace, makeTrace, releaseTrace, expandTrace } from './trace-live.js';
import { computeTrace } from './trace-service.js';

/** Saved user presets: [{ id, label, options }]. */
export function savedPresets(app) {
  const list = app.prefs?.get('tracePresets');
  return Array.isArray(list) ? list.filter((p) => p && p.id && p.label && p.options) : [];
}

/** Settings for new traces: { preset, options } (the last used ones). */
export function traceSettings(app) {
  const s = app.prefs?.get('traceSettings');
  if (s && s.options) return { preset: s.preset ?? null, options: normalizeOptions(s.options) };
  return { preset: DEFAULT_PRESET, options: presetOptions(DEFAULT_PRESET) };
}

export function setTraceSettings(app, { preset, options }) {
  const o = normalizeOptions(options);
  const p = preset !== undefined ? preset : matchingPreset(o, savedPresets(app))?.id ?? null;
  app.prefs?.set('traceSettings', { preset: p, options: o });
}

/** Trace objects in or above the selection (selecting the source image counts). */
export function selectedTraces(editor) {
  if (!editor) return [];
  const out = new Set();
  for (const id of editor.selection) {
    let n = editor.doc.get(id);
    while (n && !isTrace(n)) n = n.parent ? editor.doc.get(n.parent) : null;
    if (n) out.add(n.id);
  }
  return [...out].map((id) => editor.doc.get(id));
}

/** Plain placed images among the top-level selection (not already traced). */
export function selectedImages(editor) {
  if (!editor) return [];
  return editor
    .topSelection()
    .map((id) => editor.doc.get(id))
    .filter((n) => n && n.type === 'image' && !isTrace(editor.doc.get(n.parent)));
}

/**
 * Run `fn(onProgress, signal)` with a progress pill that can be cancelled
 * (button or Escape). Resolves to fn's result, or null when cancelled.
 */
export async function withTraceProgress(app, label, fn, { delay = 150 } = {}) {
  const controller = new AbortController();
  let pill = null;
  let bar = null;
  let pct = null;
  let value = 0;
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      controller.abort();
    }
  };
  const show = () => {
    bar = h('span.trace-progress-bar', { style: `width:${Math.round(value * 100)}%` });
    pct = h('span.trace-progress-pct', `${Math.round(value * 100)}%`);
    pill = h(
      'div.trace-progress',
      { role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value * 100)) },
      h('span.trace-progress-label', `${label}...`),
      h('span.trace-progress-track', { 'aria-hidden': 'true' }, bar),
      pct,
      h('button.btn.small', { type: 'button', onclick: () => controller.abort() }, 'Cancel'),
    );
    document.body.append(pill);
  };
  const timer = setTimeout(show, delay);
  window.addEventListener('keydown', onKey, true);
  app.root?.setAttribute('aria-busy', 'true');
  const onProgress = (v) => {
    value = Math.max(0, Math.min(1, v));
    if (!pill) return;
    const p = Math.round(value * 100);
    bar.style.width = `${p}%`;
    pct.textContent = `${p}%`;
    pill.setAttribute('aria-valuenow', String(p));
  };
  try {
    return await fn(onProgress, controller.signal);
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  } finally {
    clearTimeout(timer);
    pill?.remove();
    window.removeEventListener('keydown', onKey, true);
    app.root?.setAttribute('aria-busy', 'false');
  }
}

/**
 * Trace the selected images with the current settings and turn them into
 * trace objects (or, with `expand`, straight into grouped paths).
 */
export async function traceSelection(app, { expand = false, preset, options } = {}) {
  const ed = app.editor;
  const images = selectedImages(ed);
  if (!images.length) return [];
  const settings = traceSettings(app);
  const opts = normalizeOptions(options || settings.options);
  const presetId = preset !== undefined ? preset : options ? (matchingPreset(opts, savedPresets(app))?.id ?? null) : settings.preset;
  const doc = ed.doc;
  let results;
  try {
    results = await withTraceProgress(app, 'Tracing image', async (onProgress, signal) => {
      const out = [];
      for (let i = 0; i < images.length; i++) {
        out.push(await computeTrace(doc, images[i], opts, { signal, onProgress: (v) => onProgress((i + v) / images.length) }));
      }
      return out;
    });
  } catch (err) {
    app.notify(err?.message || 'The image could not be traced.', { error: true });
    return [];
  }
  if (!results) return [];
  // The document may have changed while tracing.
  if (app.editors && !app.editors.includes(ed)) return [];
  const ids = [];
  doc.transact(expand ? 'Trace and Expand' : 'Trace Image', () => {
    images.forEach((img, i) => {
      if (!doc.get(img.id)) return;
      const t = makeTrace(doc, img.id, { options: opts, preset: presetId, result: results[i] });
      if (!t) return;
      if (expand) ids.push(expandTrace(doc, t.id)?.id);
      else ids.push(t.id);
    });
  });
  setTraceSettings(app, { preset: presetId, options: opts });
  ed.select(ids.filter(Boolean));
  const stats = results.reduce((a, r) => ({ paths: a.paths + r.stats.paths, anchors: a.anchors + r.stats.anchors }), { paths: 0, anchors: 0 });
  app.notify?.(`Traced: ${stats.paths} paths, ${stats.anchors} anchors.`, { polite: true });
  return ids;
}

export function registerTraceCommands(app) {
  app.commands.register([
    {
      id: 'trace.make',
      label: 'Make',
      enabled: (a) => selectedImages(a.editor).length > 0,
      run: (a) => traceSelection(a),
    },
    {
      id: 'trace.makeExpand',
      label: 'Make and Expand',
      enabled: (a) => selectedImages(a.editor).length > 0,
      run: (a) => traceSelection(a, { expand: true }),
    },
    {
      id: 'trace.release',
      label: 'Release',
      enabled: (a) => selectedTraces(a.editor).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = [];
        ed.doc.transact('Release Trace', () => selectedTraces(ed).forEach((n) => ids.push(releaseTrace(ed.doc, n.id))));
        ed.select(ids.filter(Boolean));
      },
    },
    {
      id: 'trace.expand',
      label: 'Expand',
      enabled: (a) => selectedTraces(a.editor).some((n) => n.live.result),
      run: (a) => {
        const ed = a.editor;
        const ids = [];
        ed.doc.transact('Expand Trace', () => selectedTraces(ed).forEach((n) => ids.push(expandTrace(ed.doc, n.id)?.id)));
        ed.select(ids.filter(Boolean));
      },
    },
  ]);
}

/** Small labeled stat for the info rows. */
export function statItem(iconName, label) {
  const value = h('span.trace-stat-value', '0');
  const el = h('span.trace-stat', { 'data-tip': label }, icon(iconName, 14), h('span.sr-only', `${label}: `), value);
  return { el, set: (v) => (value.textContent = v == null ? '–' : Number(v).toLocaleString()) };
}
