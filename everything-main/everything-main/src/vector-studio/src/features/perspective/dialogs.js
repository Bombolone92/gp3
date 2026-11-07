/**
 * Perspective dialogs: Define Grid (live preview on the canvas), Grid
 * Presets, Save Grid as Preset, plane position and Edit Text.
 */
import { h } from '../../lib/dom.js';
import { formatLength, parseLength, parseNumber, UNITS } from '../../lib/units.js';
import { gridFromSettings, settingsOf, TYPE_LABELS, PLANE_LABELS, DEFAULT_COLORS } from './grid-math.js';
import { gridOf, setGrid, isPerspective } from './model.js';
import { pstate, setPState } from './state.js';
import { allPresets, savePreset, deletePreset, uniqueName, BUILTIN_PRESETS } from './presets.js';
import { movePlane, perspectiveTexts, setTextContent } from './ops.js';

const UNIT_KEYS = ['pt', 'px', 'in', 'mm', 'cm', 'pc'];
const SCALES = [1, 2, 4, 5, 10, 20, 50, 100];

let fid = 0;
const nextId = () => `persp-${++fid}`;

/** A labelled row: [label, control, help?]. */
function row(label, control, help = null) {
  const id = control.id || (control.id = nextId());
  const helpEl = help ? h('p.form-help', { id: `${id}-help` }, help) : null;
  if (helpEl) control.setAttribute('aria-describedby', helpEl.id);
  return h('div.form-row', h('label', { for: id }, label), control, helpEl);
}

function lengthInput(value, unit, onchange) {
  const input = h('input', { type: 'text', inputmode: 'decimal', spellcheck: false, autocomplete: 'off', value: formatLength(value, unit) });
  input.addEventListener('change', () => {
    const v = parseLength(input.value, unit);
    if (Number.isFinite(v)) input.value = formatLength(v, unit);
    onchange();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const cur = parseLength(input.value, unit);
    if (!Number.isFinite(cur)) return;
    const step = (UNITS[unit]?.factor || 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
    input.value = formatLength(cur + step, unit);
    onchange();
  });
  input.read = () => parseLength(input.value, unit);
  input.write = (v) => (input.value = formatLength(v, unit));
  return input;
}

function select(options, value, onchange) {
  const el = h(
    'select',
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)),
  );
  el.addEventListener('change', onchange);
  return el;
}

/**
 * Define Grid: type, units, scale, grid line spacing, viewing angle and
 * distance, horizon height, the third vanishing point, plane colors and
 * opacity. The grid on the canvas follows every change; Cancel restores it.
 * With `commit: false` (editing a preset) the grid is restored either way
 * and the chosen settings are returned. Returns the settings, or null.
 */
export async function defineGridDialog(app, { initial = null, commit = true } = {}) {
  const ed = app.editor;
  if (!ed) return null;
  const doc = ed.doc;
  const docUnit = doc.root.units || 'pt';
  const wasVisible = pstate(ed).visible;
  const start = gridOf(doc);
  const board = ed.artboard() || doc.artboards[0];
  let s = { ...settingsOf(start), ...(initial || {}) };
  s.colors = { ...DEFAULT_COLORS, ...(s.colors || {}) };
  const tx = doc.begin('Define Perspective Grid');
  if (!wasVisible) setPState(ed, { visible: true });

  const errors = h('p.form-error', { role: 'alert' });
  const presetSel = select([{ value: '', label: 'Custom' }, ...allPresets(app.prefs).map((p) => ({ value: p.name, label: p.name }))], '', () => {
    const p = allPresets(app.prefs).find((x) => x.name === presetSel.value);
    if (!p) return;
    s = { ...s, ...JSON.parse(JSON.stringify(p.settings)) };
    fill();
    apply(false);
  });
  const type = select(['one', 'two', 'three'].map((t) => ({ value: t, label: TYPE_LABELS[t] })), s.type, () => apply());
  const units = select(UNIT_KEYS.map((u) => ({ value: u, label: UNITS[u].label })), s.units || docUnit, () => {
    // Show the line spacing in the new units.
    s.units = units.value;
    rebuildEvery();
    apply();
  });
  const scaleSel = select([...SCALES.map((k) => ({ value: String(k), label: `1:${k}` })), { value: 'custom', label: 'Custom...' }], SCALES.includes(s.scale) ? String(s.scale) : 'custom', () => {
    customScale.hidden = scaleSel.value !== 'custom';
    apply();
  });
  const customScale = h('input', { type: 'text', inputmode: 'decimal', value: String(s.scale || 1), 'aria-label': 'Real units per page unit', hidden: SCALES.includes(s.scale) });
  customScale.addEventListener('change', () => apply());
  let every = lengthInput(s.every ?? s.cell, s.units || docUnit, () => apply());
  const everyHost = h('div.persp-every', every);
  const rebuildEvery = () => {
    const v = every.read();
    every = lengthInput(Number.isFinite(v) ? v : s.cell, units.value, () => apply());
    everyHost.replaceChildren(every);
  };
  const scaleInfo = h('p.form-help.persp-scale-info');
  const angle = h('input', { type: 'range', min: 5, max: 85, step: 1, value: Math.round(s.angle ?? 45), 'aria-valuetext': `${Math.round(s.angle ?? 45)} degrees` });
  const angleOut = h('output.range-out', `${Math.round(s.angle ?? 45)}°`);
  angle.addEventListener('input', () => {
    angleOut.textContent = `${angle.value}°`;
    angle.setAttribute('aria-valuetext', `${angle.value} degrees`);
    apply();
  });
  angle.id = nextId();
  const distance = lengthInput(s.distance ?? 480, docUnit, () => apply());
  const horizon = lengthInput(s.horizonHeight ?? 250, docUnit, () => apply());
  const thirdX = lengthInput(s.third?.x ?? 0, docUnit, () => apply());
  const thirdY = lengthInput(s.third?.y ?? 1200, docUnit, () => apply());
  thirdX.setAttribute('aria-label', 'Third vanishing point, horizontal offset from the ground point');
  thirdY.setAttribute('aria-label', 'Third vanishing point, vertical offset from the ground point');
  const thirdRow = h('div.form-row', h('span.form-label', 'Third vanishing point'), h('div.persp-pair', h('span.persp-axis', { 'aria-hidden': 'true' }, 'X'), thirdX, h('span.persp-axis', { 'aria-hidden': 'true' }, 'Y'), thirdY));
  const colors = {};
  for (const p of ['left', 'right', 'floor']) {
    colors[p] = h('input', { type: 'color', value: s.colors[p] || DEFAULT_COLORS[p] });
    colors[p].addEventListener('input', () => apply());
  }
  const opacity = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((s.opacity ?? 0.5) * 100) });
  opacity.id = nextId();
  const opacityOut = h('output.range-out', `${opacity.value}%`);
  opacity.addEventListener('input', () => {
    opacityOut.textContent = `${opacity.value}%`;
    apply();
  });

  const fill = () => {
    type.value = s.type;
    units.value = s.units || docUnit;
    scaleSel.value = SCALES.includes(s.scale) ? String(s.scale) : 'custom';
    customScale.value = String(s.scale || 1);
    customScale.hidden = scaleSel.value !== 'custom';
    rebuildEvery();
    every.write(s.every ?? s.cell);
    angle.value = Math.round(s.angle ?? 45);
    angleOut.textContent = `${angle.value}°`;
    distance.write(s.distance ?? 480);
    horizon.write(s.horizonHeight ?? 250);
    thirdX.write(s.third?.x ?? 0);
    thirdY.write(s.third?.y ?? 1200);
    for (const p of ['left', 'right', 'floor']) colors[p].value = s.colors?.[p] || DEFAULT_COLORS[p];
    opacity.value = Math.round((s.opacity ?? 0.5) * 100);
    opacityOut.textContent = `${opacity.value}%`;
  };

  const read = () => {
    const scale = scaleSel.value === 'custom' ? parseNumber(customScale.value) : Number(scaleSel.value);
    const out = {
      type: type.value,
      units: units.value,
      scale,
      every: every.read(),
      angle: Number(angle.value),
      distance: distance.read(),
      horizonHeight: horizon.read(),
      third: { x: thirdX.read(), y: thirdY.read() },
      colors: { left: colors.left.value, right: colors.right.value, floor: colors.floor.value },
      opacity: Number(opacity.value) / 100,
    };
    out.cell = out.every / (scale || 1);
    return out;
  };

  const validate = (v) => {
    if (!(v.scale > 0)) return 'Enter a scale above zero.';
    if (!(v.every > 0)) return 'Enter a grid line spacing above zero.';
    if (!(v.cell >= 1)) return 'The grid lines would be closer than 1 pt on the page. Increase the spacing or the scale.';
    if (!(v.distance > 0)) return 'Enter a viewing distance above zero.';
    if (!Number.isFinite(v.horizonHeight)) return 'Enter a horizon height.';
    if (v.type === 'three' && !(Number.isFinite(v.third.x) && Number.isFinite(v.third.y) && Math.abs(v.third.y + v.horizonHeight) > 1)) return 'Place the third vanishing point above or below the horizon.';
    return '';
  };

  const apply = (custom = true) => {
    const v = read();
    if (custom) presetSel.value = '';
    thirdRow.hidden = v.type !== 'three';
    const unitLabel = UNITS[v.units]?.label.toLowerCase() || v.units;
    scaleInfo.textContent = `On the corner line, 1 ${v.units} on the page stands for ${Number((v.scale || 0).toFixed(4))} ${v.units} (${unitLabel}) in the scene.`;
    const err = validate(v);
    errors.textContent = err;
    if (err) return null;
    const g = gridFromSettings(v, board, start);
    s = { ...s, ...v };
    setGrid(doc, g);
    return g;
  };

  const savePresetBtn = h('button.btn.small', {
    type: 'button',
    onclick: async () => {
      const v = read();
      if (validate(v)) return;
      const name = await namePrompt(app, uniqueName(app.prefs, `${TYPE_LABELS[v.type]} Preset`));
      if (!name) return;
      try {
        const saved = savePreset(app.prefs, name, v);
        presetSel.append(h('option', { value: saved }, saved));
        presetSel.value = saved;
      } catch (err) {
        errors.textContent = err.message;
      }
    },
  }, 'Save Preset...');

  const body = h(
    'div.form.persp-define',
    h('div.form-row', h('label', { for: (presetSel.id = nextId()) }, 'Preset'), h('div.persp-preset', presetSel, savePresetBtn)),
    h('h3.form-heading', 'Grid'),
    row('Type', type),
    row('Units', units),
    h('div.form-row', h('label', { for: (scaleSel.id = nextId()) }, 'Scale'), h('div.persp-pair', scaleSel, customScale)),
    h('div.form-row', h('label', { for: every.id || (every.id = nextId()) }, 'Grid line every'), everyHost),
    scaleInfo,
    h('h3.form-heading', 'View'),
    h('div.form-row', h('label', { for: angle.id }, 'Viewing angle'), h('div.range-wrap', angle, angleOut)),
    row('Viewing distance', distance, 'How far the viewer stands from the page: shorter distances exaggerate the perspective.'),
    row('Horizon height', horizon, 'Eye level above the ground.'),
    thirdRow,
    h('h3.form-heading', 'Colors'),
    ...['left', 'right', 'floor'].map((p) => row(PLANE_LABELS[p], colors[p])),
    h('div.form-row', h('label', { for: opacity.id }, 'Opacity'), h('div.range-wrap', opacity, opacityOut)),
    errors,
  );
  thirdRow.hidden = s.type !== 'three';
  apply(!initial);
  if (initial) presetSel.value = allPresets(app.prefs).some((p) => p.name === initial.name) ? initial.name : '';

  const ok = await app.dialogs.open({
    title: 'Define Perspective Grid',
    className: 'persp-dialog',
    body,
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'OK', primary: true, value: true, validate: () => Boolean(apply(presetSel.value === '')) },
    ],
  });
  const result = ok ? read() : null;
  if (ok && commit) tx.commit();
  else {
    tx.cancel();
    if (!wasVisible) setPState(ed, { visible: false });
  }
  return result;
}

/** Ask for a preset name. */
async function namePrompt(app, value) {
  const v = await app.dialogs.form({ title: 'Save Grid as Preset', fields: [{ key: 'name', label: 'Preset name', type: 'text', value }], okLabel: 'Save' });
  const name = String(v?.name || '').trim();
  return name || null;
}

/** Save the document's grid as a preset. */
export async function saveGridPresetDialog(app) {
  const ed = app.editor;
  if (!ed) return null;
  const s = settingsOf(gridOf(ed.doc));
  const name = await namePrompt(app, uniqueName(app.prefs, `${TYPE_LABELS[s.type]} Preset`));
  if (!name) return null;
  const saved = savePreset(app.prefs, name, s);
  app.notify(`Saved the grid as "${saved}".`, { polite: true });
  return saved;
}

/** Apply a preset to the document's grid (keeping its position). */
export function applyPreset(app, preset) {
  const ed = app.editor;
  if (!ed || !preset) return;
  const doc = ed.doc;
  const g = gridFromSettings(preset.settings, ed.artboard() || doc.artboards[0], gridOf(doc));
  doc.transact(`Apply Grid Preset`, () => setGrid(doc, { ...g, name: preset.name }));
  setPState(ed, { visible: true });
}

/** Edit > Perspective Grid Presets: list, new, edit, delete, apply. */
export async function presetsDialog(app) {
  const list = h('div.persp-preset-list', { role: 'listbox', 'aria-label': 'Presets', tabindex: '0' });
  const details = h('dl.persp-preset-details');
  let selected = BUILTIN_PRESETS[0].name;
  const presets = () => allPresets(app.prefs);
  const current = () => presets().find((p) => p.name === selected) || presets()[0];
  const btnEdit = h('button.btn.small', { type: 'button' }, 'Edit...');
  const btnDelete = h('button.btn.small', { type: 'button' }, 'Delete');
  const describe = (p) => {
    const st = p.settings;
    const unit = st.units || 'pt';
    const rows = [
      ['Type', TYPE_LABELS[st.type]],
      ['Grid line every', `${formatLength(st.every ?? st.cell, unit)} at 1:${Number(st.scale || 1)}`],
      ['Viewing angle', st.type === 'one' ? '—' : `${Number((st.angle ?? 45).toFixed(1))}°`],
      ['Viewing distance', formatLength(st.distance ?? 480, unit)],
      ['Horizon height', formatLength(st.horizonHeight ?? 250, unit)],
    ];
    if (st.type === 'three' && st.third) rows.push(['Third vanishing point', `${formatLength(st.third.x, unit)}, ${formatLength(st.third.y, unit)}`]);
    details.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
  };
  const render = () => {
    const ps = presets();
    if (!ps.some((p) => p.name === selected)) selected = ps[0]?.name;
    list.replaceChildren(
      ...ps.map((p) =>
        h(
          'div.persp-preset-item',
          {
            role: 'option',
            id: `persp-preset-${ps.indexOf(p)}`,
            'aria-selected': p.name === selected ? 'true' : 'false',
            onclick: () => {
              selected = p.name;
              render();
            },
            ondblclick: () => apply(),
          },
          p.name,
          p.builtin ? h('span.persp-preset-tag', 'Built-in') : null,
        ),
      ),
    );
    list.setAttribute('aria-activedescendant', `persp-preset-${ps.findIndex((p) => p.name === selected)}`);
    const p = current();
    btnEdit.disabled = !p || p.builtin;
    btnDelete.disabled = !p || p.builtin;
    if (p) describe(p);
  };
  list.addEventListener('keydown', (e) => {
    const ps = presets();
    const i = ps.findIndex((p) => p.name === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = ps[Math.max(0, Math.min(ps.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].name;
      render();
    }
  });
  let close = null;
  const apply = () => close?.('apply');
  const editPreset = async (p, isNew) => {
    // The grid dialog edits the settings; the document grid is left as it was.
    const ed = app.editor;
    if (!ed) {
      app.notify('Open a document to edit grid presets.');
      return;
    }
    const settings = await defineGridDialog(app, { initial: { ...p.settings, name: p.name }, commit: false });
    if (!settings) return;
    const name = isNew ? await namePrompt(app, uniqueName(app.prefs, `${TYPE_LABELS[settings.type]} Preset`)) : p.name;
    if (!name) return;
    selected = savePreset(app.prefs, name, settings);
    render();
  };
  btnEdit.addEventListener('click', () => {
    const p = current();
    if (p && !p.builtin) editPreset(p, false);
  });
  btnDelete.addEventListener('click', () => {
    const p = current();
    if (!p || p.builtin) return;
    deletePreset(app.prefs, p.name);
    render();
  });
  const btnNew = h('button.btn.small', { type: 'button', onclick: () => editPreset(current() || BUILTIN_PRESETS[0], true) }, 'New...');
  render();
  const body = h(
    'div.persp-presets',
    h('div.persp-presets-list', h('span.form-label', 'Presets'), list, h('div.persp-preset-actions', btnNew, btnEdit, btnDelete)),
    h('div.persp-presets-info', h('span.form-label', 'Settings'), details),
  );
  const res = await app.dialogs.open({
    title: 'Perspective Grid Presets',
    className: 'persp-dialog wide',
    body,
    onOpen: (o) => {
      close = o.close;
    },
    buttons: [
      { label: 'Close', value: false },
      { label: 'Apply', primary: true, value: 'apply', disabled: !app.editor },
    ],
  });
  if (res === 'apply' && app.editor) applyPreset(app, current());
  return res === 'apply';
}

/**
 * Plane position: move a grid plane to an exact position, optionally with
 * the objects on it.
 */
export async function planePositionDialog(app, plane) {
  const ed = app.editor;
  if (!ed) return;
  const g = gridOf(ed.doc);
  const v = await app.dialogs.form({
    title: `${PLANE_LABELS[plane]} Position`,
    fields: [
      { key: 'offset', label: plane === 'floor' ? 'Height' : 'Distance from the corner', type: 'length', value: g.planes[plane] || 0 },
      {
        key: 'objects',
        label: 'Objects on the plane',
        type: 'radio',
        value: 'stay',
        options: [
          { value: 'stay', label: 'Stay' },
          { value: 'move', label: 'Move with the plane' },
          { value: 'copy', label: 'Copy to the plane' },
        ],
      },
    ],
  });
  if (!v || !Number.isFinite(v.offset)) return;
  ed.doc.transact('Move Perspective Plane', () => movePlane(ed.doc, plane, v.offset, v.objects === 'move' ? true : v.objects === 'copy' ? 'copy' : false));
}

/** Edit the type of a perspective object; the canvas shows each change in perspective. */
export async function editTextDialog(app, id) {
  const ed = app.editor;
  const doc = ed?.doc;
  const node = doc?.get(id);
  if (!isPerspective(node)) return false;
  const texts = perspectiveTexts(doc, id);
  if (!texts.length) return false;
  const tx = doc.begin('Edit Text');
  const areas = texts.map((t, i) => {
    const area = h('textarea.persp-text', { rows: Math.min(8, Math.max(2, String(t.text).split('\n').length + 1)), 'aria-label': texts.length > 1 ? `Text ${i + 1}` : 'Text' }, t.text);
    area.addEventListener('input', () => setTextContent(doc, t.id, area.value));
    return area;
  });
  const ok = await app.dialogs.open({
    title: 'Edit Text in Perspective',
    body: h('div.form.persp-edit-text', h('p.form-description', 'Changes show on the canvas as you type.'), ...areas),
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'OK', primary: true, value: true },
    ],
  });
  if (ok) tx.commit();
  else tx.cancel();
  return Boolean(ok);
}

