// Info panel: two color readouts under the pointer (each in a chosen color
// model), pointer position and selection / transform / ruler sizes in ruler
// units, one readout per color sampler (before/after values while a change
// is previewed), and document status lines chosen in Info Panel Options.
import type { Editor } from '../../editor';
import { registerCommand, type Panel } from '../../app/registry';
import { escapeXML } from '../../model/assets';
import { svg } from '../../app/icons';
import { selectedRoots } from '../../model/layers';
import { selectionFrame } from '../../model/transform';
import { documentTileIds } from '../../model/pixel-layer';
import { documentPpi } from '../../model/text-layer';
import type { PhotoDocument } from '../../model/document';
import { formatUnit, isDefaultScale, round, RULER_UNITS, sampleAverage, short } from '../../imaging/measure/geometry';
import { formatBytes, imageBytes } from '../transform/math';
import { annotationsOf, baseImage, lengthText, onSnapshot, previewImage, rulerUnit } from './state';
import { channels, compareChannels, isModel, onEngineReady, profileText, READOUT_MODELS, type Channel, type Color, type ReadoutModel } from './readout';
import { deleteSampler, sampleSize, samplerColors, samplers } from './samplers';
import { rulerReadout } from './ruler';
import { formDialog } from '../../ui/dialog';

// ----- Options (remembered per browser) -----
export type StatusItem = 'dimensions' | 'profile' | 'size' | 'memory' | 'scale' | 'tool';
const STATUS_ITEMS: [StatusItem, string][] = [
  ['dimensions', 'Dimensions and resolution'],
  ['profile', 'Color profile and mode'],
  ['size', 'Document size (flattened / layers)'],
  ['memory', 'Memory used by pixel tiles'],
  ['scale', 'Measurement scale'],
  ['tool', 'Current tool hint'],
];
type InfoOptions = { first: ReadoutModel; second: ReadoutModel; samplers: ReadoutModel[]; status: StatusItem[] };
const defaults: InfoOptions = { first: 'actual', second: 'cmyk', samplers: [], status: ['dimensions', 'profile', 'size'] };
let options: InfoOptions = load();
function load(): InfoOptions {
  try {
    const v = JSON.parse(localStorage.getItem('photo-studio-info') ?? 'null');
    if (v && typeof v === 'object')
      return {
        first: isModel(v.first) ? v.first : defaults.first,
        second: isModel(v.second) ? v.second : defaults.second,
        samplers: Array.isArray(v.samplers) ? v.samplers.map((m: unknown) => (isModel(m) ? m : 'actual')).slice(0, 10) : [],
        status: Array.isArray(v.status) ? v.status.filter((s: unknown) => STATUS_ITEMS.some(([id]) => id === s)) : defaults.status,
      };
  } catch {
    /* Optional. */
  }
  return structuredClone(defaults);
}
function save() {
  try {
    localStorage.setItem('photo-studio-info', JSON.stringify(options));
  } catch {
    /* Optional. */
  }
}
const samplerModel = (i: number): ReadoutModel => options.samplers[i] ?? 'actual';

// ----- Values -----
function pointerColors(e: Editor): { before: Color | null; after?: Color | null } {
  const p = e.pointerInfo;
  if (!p || p.x < 0 || p.y < 0 || p.x >= e.doc.width || p.y >= e.doc.height) return { before: null };
  const base = baseImage(e),
    pre = previewImage(e),
    n = sampleSize(e);
  return {
    before: base ? sampleAverage(base, p.x, p.y, n) : null,
    ...(pre && pre.width === e.doc.width ? { after: sampleAverage(pre, p.x, p.y, n) } : {}),
  };
}
/** Width and height shown beside the position: the transform frame, the
 * selection bounds, or nothing. */
function sizeReadout(e: Editor): { label: string; w: string; h: string; extra?: [string, string][] } | null {
  const r = e.tool === 'ruler' ? rulerReadout(e) : undefined;
  if (r) return { label: 'Ruler', w: r.w, h: r.h, extra: [['A', r.angle], ['L', r.metrics.l2 !== undefined ? `${r.l1} / ${r.l2}` : r.l1]] };
  if (e.transform.active && e.transform.document) {
    const f = selectionFrame(selectedRoots(e.transform.document.layers, e.selectedIds));
    if (f) return { label: 'Transform', w: lengthText(e, f.width, 'x'), h: lengthText(e, f.height, 'y'), extra: [['∠', `${round(f.rotation, 1)}°`]] };
  }
  const b = e.doc.selection;
  if (b) return { label: 'Selection', w: lengthText(e, b.width, 'x'), h: lengthText(e, b.height, 'y') };
  return null;
}
let tileCache: { doc: PhotoDocument; bytes: number } | undefined;
function layerBytes(e: Editor) {
  if (tileCache?.doc !== e.doc) {
    let bytes = 0;
    for (const id of documentTileIds(e.doc)) if (e.assets.tiles.has(id)) bytes += e.assets.tiles.get(id).byteLength;
    tileCache = { doc: e.doc, bytes };
  }
  return tileCache.bytes;
}
/** One document status line (label, text); also shown in the status bar. */
export function statusLine(e: Editor, item: StatusItem): [string, string] {
  const d = e.doc;
  const ppi = documentPpi(d);
  if (item === 'dimensions')
    return ['Dimensions', `${d.width} × ${d.height} px (${formatUnit(d.width, 'in', ppi, d.width)} × ${formatUnit(d.height, 'in', ppi, d.height)} in, ${round(ppi, ppi % 1 ? 1 : 0)} ppi)`];
  if (item === 'profile') return ['Profile', `${profileText(e)} · ${e.colorModeLabel}/${d.bitsPerChannel ?? 8}`];
  if (item === 'size') {
    const channels = d.mode === 'cmyk' ? 4 : d.mode === 'grayscale' || d.mode === 'bitmap' || d.mode === 'duotone' ? 1 : 3;
    return ['Size', `${formatBytes(imageBytes(d.width, d.height, d.bitsPerChannel ?? 8, channels))} flattened / ${formatBytes(layerBytes(e))} in layers`];
  }
  if (item === 'memory') return ['Memory', `${formatBytes(e.assets.tiles.bytes)} in ${e.assets.tiles.size.toLocaleString()} tiles (with history)`];
  if (item === 'scale') {
    const s = annotationsOf(d).scale;
    return ['Scale', isDefaultScale(s) ? '1 pixel = 1 pixel' : `${short(s!.pixels, 2)} px = ${short(s!.length, 4)} ${s!.units}`];
  }
  return ['Tool', toolHint(e)];
}
const statusLines = (e: Editor) => options.status.map((item) => statusLine(e, item));
function toolHint(e: Editor) {
  const hints: Record<string, string> = {
    'color-sampler': 'Click to add a sampler, drag to move, Alt-click to delete.',
    ruler: 'Drag to measure; Alt-drag an end for a second line.',
    count: 'Click to count; Alt-click a marker to remove it.',
    note: 'Click to pin a note; drag a note to move it.',
    eyedropper: 'Click to pick the foreground color; Alt-click for the background.',
  };
  return hints[e.tool] ?? e.activeTool?.label ?? '';
}

// ----- Markup -----
const modelSelect = (attr: string, value: ReadoutModel, label: string) =>
  `<select ${attr} aria-label="${escapeXML(label)}" class="info-model">${READOUT_MODELS.map(([id, l]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const rows = (list: Channel[], key: string) =>
  `<dl class="info-values">${list.map(([l], i) => `<dt>${escapeXML(l)}</dt><dd data-v="${key}-${i}"></dd>`).join('')}</dl>`;

function structureKey(e: Editor) {
  const size = sizeReadout(e);
  return JSON.stringify([options, samplers(e).length, e.doc.mode, rulerUnit(e), size?.label, size?.extra?.length, e.hasDocument]);
}
function build(e: Editor, el: HTMLElement) {
  const unit = rulerUnit(e);
  const size = sizeReadout(e);
  const blank = (m: ReadoutModel) => channels(e, null, m);
  const list = samplers(e);
  el.innerHTML = `<div class="info-readouts"><section class="info-block"><header>${svg('pipette', 13)}${modelSelect('data-info-model="first"', options.first, 'First readout')}</header>${rows(blank(options.first), 'p1')}</section><section class="info-block"><header>${svg('pipette', 13)}${modelSelect('data-info-model="second"', options.second, 'Second readout')}</header>${rows(blank(options.second), 'p2')}</section></div><div class="info-readouts info-geometry"><section class="info-block"><header>${svg('crosshair', 13)}<select data-info-unit aria-label="Ruler units" class="info-model">${RULER_UNITS.map(([id, l]) => `<option value="${id}" ${id === unit ? 'selected' : ''}>${l}</option>`).join('')}</select></header><dl class="info-values"><dt>X</dt><dd data-v="x"></dd><dt>Y</dt><dd data-v="y"></dd></dl></section><section class="info-block"><header>${svg('scan', 13)}<span>${size ? escapeXML(size.label) : 'Size'}</span></header><dl class="info-values"><dt>W</dt><dd data-v="w"></dd><dt>H</dt><dd data-v="h"></dd>${(size?.extra ?? []).map(([l], i) => `<dt>${escapeXML(l)}</dt><dd data-v="extra-${i}"></dd>`).join('')}</dl></section></div>${
    list.length
      ? `<div class="info-readouts info-samplers">${list.map((_, i) => `<section class="info-block sampler"><header><b class="sampler-number">#${i + 1}</b>${modelSelect(`data-sampler-model="${i}"`, samplerModel(i), `Sampler ${i + 1} readout`)}<button class="icon-button" data-delete-sampler="${i}" aria-label="Delete sampler ${i + 1}" title="Delete sampler">${svg('x', 12)}</button></header>${rows(blank(samplerModel(i)), `s${i}`)}</section>`).join('')}</div>`
      : ''
  }<div class="info-status" data-v="status"></div>`;
}
function fill(e: Editor, el: HTMLElement) {
  const set = (key: string, v: string) => {
    const n = el.querySelector(`[data-v="${key}"]`);
    if (n && n.textContent !== v) n.textContent = v;
  };
  const p = pointerColors(e);
  const put = (key: string, list: Channel[]) => list.forEach(([, v], i) => set(`${key}-${i}`, v));
  put('p1', compareChannels(e, p.before, p.after, options.first));
  put('p2', compareChannels(e, p.before, p.after, options.second));
  const pt = e.pointerInfo;
  set('x', pt ? lengthText(e, pt.x, 'x') : '–');
  set('y', pt ? lengthText(e, pt.y, 'y') : '–');
  const size = sizeReadout(e);
  set('w', size?.w ?? '–');
  set('h', size?.h ?? '–');
  size?.extra?.forEach(([, v], i) => set(`extra-${i}`, v));
  samplers(e).forEach((s, i) => {
    const c = samplerColors(e, s);
    put(`s${i}`, compareChannels(e, c.before, c.after, samplerModel(i)));
  });
  const status = el.querySelector<HTMLElement>('[data-v="status"]');
  if (status) {
    const html = e.hasDocument ? statusLines(e).map(([k, v]) => `<div><span>${escapeXML(k)}</span><span>${escapeXML(v)}</span></div>`).join('') : '';
    if (status.innerHTML !== html) status.innerHTML = html;
  }
}
function render(e: Editor, el: HTMLElement) {
  const key = structureKey(e);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    build(e, el);
  }
  fill(e, el);
}

async function optionsDialog(e: Editor) {
  const models = READOUT_MODELS.map(([id, l]) => [id, l] as [string, string]);
  const v = await formDialog(
    'Info Panel Options',
    [
      { name: 'first', label: 'First readout', value: options.first, type: 'select', options: models },
      { name: 'second', label: 'Second readout', value: options.second, type: 'select', options: models },
      { name: 'units', label: 'Ruler units', value: rulerUnit(e), type: 'select', options: RULER_UNITS.map(([id, l]) => [id, l]) },
      ...STATUS_ITEMS.map(([id, l]) => ({ name: `status-${id}`, label: l, value: options.status.includes(id) ? 'yes' : 'no', type: 'checkbox' })),
    ],
    'OK',
  );
  if (!v) return;
  options = { ...options, first: isModel(v.first) ? v.first : options.first, second: isModel(v.second) ? v.second : options.second, status: STATUS_ITEMS.map(([id]) => id).filter((id) => v[`status-${id}`] === 'yes') };
  save();
  setUnits(e, v.units);
}
export function setUnits(e: Editor, unit: string) {
  if (!RULER_UNITS.some(([id]) => id === unit)) return;
  e.preferences.rulerUnits = unit;
  e.savePreferences();
  e.update();
}

let panelEl: HTMLElement | undefined;
let editor: Editor | undefined;
function refresh() {
  if (editor && panelEl?.isConnected && editor.dock.isVisible('info')) render(editor, panelEl);
}
onSnapshot(refresh);
onEngineReady(refresh);

export const infoPanel: Panel = {
  id: 'info',
  title: 'Info',
  icon: 'info',
  location: 'strip',
  shortcut: 'F8',
  mount: (e, el) => {
    panelEl = el;
    editor = e;
    el.classList.add('info-panel');
    e.pointerHooks.push(() => refresh());
    el.addEventListener('change', (ev) => {
      const t = ev.target as HTMLSelectElement;
      if (t.dataset.infoModel && isModel(t.value)) {
        options[t.dataset.infoModel as 'first' | 'second'] = t.value;
        save();
        render(e, el);
      } else if (t.dataset.samplerModel !== undefined && isModel(t.value)) {
        const i = Number(t.dataset.samplerModel);
        while (options.samplers.length <= i) options.samplers.push('actual');
        options.samplers[i] = t.value;
        save();
        render(e, el);
      } else if (t.matches('[data-info-unit]')) setUnits(e, t.value);
    });
    el.addEventListener('click', (ev) => {
      const del = (ev.target as HTMLElement).closest<HTMLElement>('[data-delete-sampler]');
      if (del) deleteSampler(e, Number(del.dataset.deleteSampler));
    });
  },
  update: (e, el) => render(e, el),
  menu: () => ['info.options', '-', 'samplers.clear'],
};

export function installInfo(_e: Editor) {
  registerCommand({ id: 'info.options', label: 'Info Panel Options…', run: (e) => optionsDialog(e), recordable: false });
}
