// Layer → Harmonize…: match the selected layer's color and tone to the layers
// beneath it (see harmonize-math). The result is a Color Lookup adjustment
// layer clipped to the layer (editable, removable) or, for pixel layers,
// applied to the pixels. The canvas previews the result while the dialog is
// open.
import type { Editor } from '../../editor';
import { findLayer, layer as newLayer, type Layer, type PhotoDocument } from '../../model/document';
import { setLayerPixels } from '../../model/pixel-layer';
import { gridDocBounds, gridFromImage, readMask, readRGBA } from '../../model/tiles';
import { boundingBox } from '../../imaging/segment/mask-ops';
import type { Adjustment } from '../../imaging/adjust';
import { mask8, type RGBA8 } from '../../imaging/types';
import { openShell, latest } from '../adjust/dialog';
import { h, select, slider } from '../adjust/ui';
import { adjustmentSpec } from '../adjust/compile';
import { adjustInWorker } from '../adjust/worker-client';
import { labStats, type LabStats } from '../adjust/match-color';
import { compositeRGBA, layerRGBA } from '../pixels';
import { recordStep } from '../filters/record';
import { givenParams } from './client';
import { DEFAULT_HARMONIZE, canHarmonize, contextRect, harmonizeCube, harmonizeLut, type HarmonizeOptions } from './harmonize-math';
import './assist.css';


/** The document as it looks beneath layer `id`: that layer and everything
 * painted after it (above it, also in enclosing groups) is hidden. */
export function belowDocument(doc: PhotoDocument, id: string): PhotoDocument | null {
  let found = false;
  const walk = (layers: Layer[]): Layer[] =>
    layers.map((l) => {
      if (found) return { ...l, visible: false };
      if (l.id === id) {
        found = true;
        return { ...l, visible: false };
      }
      return l.children.length ? { ...l, children: walk(l.children) } : l;
    });
  const layers = walk(doc.layers);
  return found ? { ...doc, layers, selection: null, selectionMask: null } : null;
}

type Stats = { layer: LabStats; below: LabStats };
/** Statistics of the layer's visible pixels and of the image beneath it
 * around the layer's bounds. */
async function measure(e: Editor, l: Layer): Promise<Stats | string> {
  const doc = e.doc;
  const own = await layerRGBA(e, { ...l, opacity: 1, blend: 'normal', style: undefined, maskGrid: undefined, mask: null, clipped: false });
  const cover = mask8(own.width, own.height);
  const m = l.maskGrid && !l.maskDisabled ? readMask(e.assets.tiles, l.maskGrid, { x: 0, y: 0, width: doc.width, height: doc.height }) : null;
  for (let i = 0; i < cover.data.length; i++) cover.data[i] = Math.min(own.data[i * 4 + 3], m ? m.data[i] : 255);
  const bounds = boundingBox(cover, 128);
  if (!bounds) return 'The layer has no visible pixels on the canvas.';
  const below = belowDocument(doc, l.id);
  if (!below) return 'The layer was not found.';
  const under = await compositeRGBA(e, below);
  const r = contextRect(bounds, doc.width, doc.height);
  const area: RGBA8 = { width: r.width, height: r.height, data: new Uint8ClampedArray(r.width * r.height * 4) };
  for (let y = 0; y < r.height; y++) area.data.set(under.data.subarray(((y + r.y) * doc.width + r.x) * 4, ((y + r.y) * doc.width + r.x + r.width) * 4), y * r.width * 4);
  const belowStats = labStats(area);
  if (belowStats.count < 16) return 'There is nothing visible beneath the layer to match.';
  return { layer: labStats(own, cover.data), below: belowStats };
}

const PREVIEW_ID = 'harmonize-preview';
function withAdjustment(doc: PhotoDocument, targetId: string, adj: Layer): PhotoDocument {
  const insert = (layers: Layer[]): Layer[] => {
    const i = layers.findIndex((l) => l.id === targetId);
    if (i >= 0) return [...layers.slice(0, i + 1), adj, ...layers.slice(i + 1)];
    return layers.map((l) => (l.children.length ? { ...l, children: insert(l.children) } : l));
  };
  return { ...doc, layers: insert(doc.layers) };
}
function adjustmentLayer(doc: PhotoDocument, adjustment: Adjustment, id?: string): Layer {
  const l = newLayer('adjustment', 'Harmonize', doc.width, doc.height);
  if (id) l.id = id;
  l.clipped = true;
  l.adjustment = adjustmentSpec(adjustment);
  return l;
}

type Output = 'adjustment' | 'pixels';
const remembered: HarmonizeOptions & { output: Output } = { ...DEFAULT_HARMONIZE, output: 'adjustment' };

export async function harmonizeDialog(e: Editor, arg?: unknown) {
  e.transform.apply();
  const l = e.layer;
  if (!canHarmonize(l)) return e.message('Select a visible layer that is not a group or an adjustment layer.');
  const target = l!;
  const stats = await measure(e, target);
  if (typeof stats === 'string') return e.message(stats);
  const pixelsOk = target.kind === 'pixel' && !!target.pixels && !target.liveFilters?.length;
  const given = givenParams(arg);
  if (given) {
    const pct = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d);
    const o = { strength: pct(given.strength, 100), luminance: pct(given.luminance, DEFAULT_HARMONIZE.luminance), color: pct(given.color, DEFAULT_HARMONIZE.color), output: (given.output === 'pixels' && pixelsOk ? 'pixels' : 'adjustment') as Output };
    return applyHarmonize(e, target.id, stats, o);
  }
  const o = { ...remembered };
  if (!pixelsOk) o.output = 'adjustment';
  const shell = openShell(e, 'Harmonize');
  shell.body.classList.add('assist-form');
  const preview = (opts: HarmonizeOptions): Adjustment => ({ kind: 'color-lookup', params: { source: { type: 'lut', name: 'Harmonize', lut: harmonizeLut(stats.layer, stats.below, opts) }, amount: 100 } });
  const schedule = latest();
  const refresh = () => {
    if (!shell.preview.checked) return e.update();
    schedule(async () => {
      if (!shell.dialog.isConnected) return;
      e.preview(withAdjustment(e.doc, target.id, adjustmentLayer(e.doc, preview(o), PREVIEW_ID)));
    });
  };
  const live = (key: keyof HarmonizeOptions) => (v: number) => {
    o[key] = v;
    refresh();
  };
  shell.body.append(
    h('p', { class: 'assist-note' }, `Matches “${target.name}” to the layers beneath it, measured around the layer’s bounds.`),
    slider({ label: 'Strength', min: 0, max: 100, unit: '%', value: o.strength, onInput: live('strength') }).el,
    slider({ label: 'Luminance', min: 0, max: 100, unit: '%', value: o.luminance, track: 'linear-gradient(90deg,#222,#ddd)', onInput: live('luminance') }).el,
    slider({ label: 'Color', min: 0, max: 100, unit: '%', value: o.color, track: 'linear-gradient(90deg,#888,#d0a040,#4a80d0)', onInput: live('color') }).el,
    select(
      'Result',
      pixelsOk ? [['adjustment', 'Clipped adjustment layer (editable)'], ['pixels', 'Apply to the layer’s pixels']] : [['adjustment', 'Clipped adjustment layer (editable)']],
      o.output,
      (v) => (o.output = v as Output),
    ).el,
  );
  shell.preview.addEventListener('change', refresh);
  refresh();
  const ok = await shell.result;
  e.update();
  if (!ok) return;
  Object.assign(remembered, o);
  recordStep(e, 'layer.harmonize', { params: { ...o } });
  await applyHarmonize(e, target.id, stats, o);
}

async function applyHarmonize(e: Editor, id: string, stats: Stats, o: HarmonizeOptions & { output: Output }) {
  const preview = (opts: HarmonizeOptions): Adjustment => ({ kind: 'color-lookup', params: { source: { type: 'lut', name: 'Harmonize', lut: harmonizeLut(stats.layer, stats.below, opts) }, amount: 100 } });
  const target = { id };
  const cur = findLayer(e.doc.layers, target.id);
  if (!cur) return;
  if (o.output === 'pixels' && cur.kind === 'pixel' && cur.pixels) {
    const b = gridDocBounds(cur.pixels);
    if (!b) return;
    const out = await adjustInWorker(readRGBA(e.assets.tiles, cur.pixels, b), preview(o));
    const grid = gridFromImage(e.assets.tiles, out, b.x, b.y);
    e.command('Harmonize', (d) => {
      const t = findLayer(d.layers, target.id);
      if (t) setLayerPixels(t, grid, d);
    });
  } else {
    const adj: Adjustment = { kind: 'color-lookup', params: { source: { type: 'cube', name: 'Harmonize', text: harmonizeCube(stats.layer, stats.below, o) }, amount: 100 } };
    const layer = adjustmentLayer(e.doc, adj);
    e.command('Harmonize', (d) => {
      const next = withAdjustment(d, target.id, layer);
      d.layers = next.layers;
    });
    e.selectLayers([layer.id]);
  }
  e.update();
}
