// Edit > Context Fill…: a workspace to choose where the fill samples from
// (automatic, rectangular or a painted area), how it adapts color, rotation,
// scale and mirroring, with a live preview, and where the result goes.
import type { Editor } from '../../editor';
import { svg } from '../../app/icons';
import { insertAboveSelection } from '../layers/insert';
import { newPixelLayer } from '../../model/pixel-layer';
import { gridFromImage, writeRect } from '../../model/tiles';
import { boundingBox } from '../../imaging/segment/mask-ops';
import { CancelledError, mask8, type IRect, type Mask8, type RGBA8 } from '../../imaging/types';
import type { ContextFillOptions } from '../../imaging/retouch';
import { buffersOf, channel, withProgress } from './client';
import { binarize, cropMask, cropRGBA, expandRect, strokeMask, unionRects } from './logic';
import { retouchTarget, selectionMask, sourceImage, sourceRect, writeResult } from './source';
import { DocView, drawImage, field, openWorkspace, options } from './workspace';

type Settings = {
  sampling: 'auto' | 'rect' | 'custom';
  color: NonNullable<ContextFillOptions['colorAdaptation']>;
  rotation: NonNullable<ContextFillOptions['rotationAdaptation']>;
  scale: boolean;
  mirror: boolean;
  sampleAll: boolean;
  output: 'current' | 'new' | 'duplicate';
  showSampling: boolean;
};
const defaults: Settings = { sampling: 'auto', color: 'default', rotation: 'none', scale: false, mirror: false, sampleAll: false, output: 'current', showSampling: true };
let remembered: Settings = { ...defaults };

// The engine's automatic source area: the hole plus a margin, minus the hole.
function autoMargin(box: IRect) {
  return Math.min(1024, Math.max(64, 3 * Math.max(box.width, box.height)));
}
function samplingFor(kind: 'auto' | 'rect', hole: Mask8, box: IRect): Mask8 {
  const { width: W, height: H } = hole;
  const m = kind === 'auto' ? autoMargin(box) : Math.max(24, Math.round(0.5 * Math.max(box.width, box.height)));
  const R = expandRect(box, m, W, H)!;
  const s = mask8(W, H);
  for (let y = R.y; y < R.y + R.height; y++) s.data.fill(255, y * W + R.x, y * W + R.x + R.width);
  for (let i = 0; i < s.data.length; i++) if (hole.data[i]) s.data[i] = 0;
  return s;
}
/** Region the fill works in (mirrors the engine), so only it is sent to the worker. */
function workRect(box: IRect, sampling: Mask8 | undefined, W: number, H: number): IRect {
  if (!sampling) return expandRect(box, autoMargin(box), W, H)!;
  const sb = boundingBox(sampling);
  return expandRect(sb ? unionRects(box, sb) : box, 8, W, H)!;
}
type Fill = { R: IRect; result: RGBA8; hole: Mask8 };
function fillJob(img: RGBA8, hole: Mask8, box: IRect, s: Settings, sampling: Mask8 | undefined, progress?: (f: number) => void, signal?: AbortSignal): Promise<Fill> {
  const { width: W, height: H } = hole;
  const R = workRect(box, s.sampling === 'auto' ? undefined : sampling, W, H);
  const crop = cropRGBA(img, R),
    h = cropMask(hole, R),
    samp = s.sampling === 'auto' || !sampling ? undefined : cropMask(sampling, R);
  const opts: ContextFillOptions = { sampling: samp, colorAdaptation: s.color, rotationAdaptation: s.rotation, scale: s.scale, mirror: s.mirror, seed: 1 };
  const holeCopy = { width: h.width, height: h.height, data: new Uint8Array(h.data) };
  return channel('heavy')
    .call<RGBA8>('context-fill', { img: crop, hole: holeCopy, opts }, { transfer: buffersOf(crop, holeCopy, samp), progress, signal })
    .then((result) => ({ R, result, hole: h }));
}
async function commitFill(e: Editor, fill: Fill, s: Settings) {
  const { R, result, hole } = fill;
  if (s.output === 'new') {
    // Only the filled pixels, on their own layer.
    const out = new Uint8ClampedArray(result.data);
    for (let i = 0; i < hole.data.length; i++) out[i * 4 + 3] = (out[i * 4 + 3] * hole.data[i]) / 255;
    insertAboveSelection(e, newPixelLayer('Context Fill', e.doc, gridFromImage(e.assets.tiles, { width: R.width, height: R.height, data: out }, R.x, R.y)), 'Context Fill');
    return;
  }
  const target = await retouchTarget(e, 'Context Fill');
  if (!target) return;
  const before = await sourceRect(e, R, false, target);
  if (s.output === 'duplicate') {
    const src = target.layer;
    const weight = binarize(hole);
    const merged = s.sampleAll ? paint(before, result, weight) : result;
    const l = newPixelLayer(`${src.name} copy`, e.doc, writeRect(e.assets.tiles, target.grid, R.x, R.y, merged));
    l.opacity = src.opacity;
    l.blend = src.blend;
    insertAboveSelection(e, l, 'Context Fill');
    return;
  }
  // The hole is the selection, already blended by its soft edge.
  writeResult(e, target, R, before, result, 'Context Fill', { sampleAll: s.sampleAll, weight: binarize(hole), limit: false });
}
function paint(before: RGBA8, after: RGBA8, weight: Mask8): RGBA8 {
  const out = new Uint8ClampedArray(before.data);
  for (let i = 0; i < weight.data.length; i++) if (weight.data[i]) out.set(after.data.subarray(i * 4, i * 4 + 4), i * 4);
  return { width: before.width, height: before.height, data: out };
}

async function prepare(e: Editor, sampleAll: boolean) {
  const hole = selectionMask(e);
  const box = hole && boundingBox(hole);
  if (!hole || !box) {
    e.message('Make a selection around the area to fill first.');
    return;
  }
  if (!sampleAll && e.layer?.kind !== 'pixel') sampleAll = true;
  const img = await withProgress(e, 'Reading the image', () => sourceImage(e, sampleAll));
  return img && { hole, box, img };
}

/** Context Fill with the remembered settings and no workspace (Fill dialog, task bar). */
export async function quickContextFill(e: Editor) {
  const s = { ...remembered, sampling: 'auto' as const };
  const p = await prepare(e, s.sampleAll);
  if (!p) return;
  if (s.output !== 'new' && !(await retouchTarget(e, 'Context Fill'))) return;
  const result = await withFill(e, p.img, p.hole, p.box, s, undefined);
  if (result) await commitFill(e, result, s);
}
function withFill(e: Editor, img: RGBA8, hole: Mask8, box: IRect, s: Settings, sampling: Mask8 | undefined) {
  return withProgress(e, 'Context Fill', (job) => fillJob(img, hole, box, s, sampling, job.progress, job.signal));
}

export async function openContextFill(e: Editor) {
  const s: Settings = { ...remembered };
  let p = await prepare(e, s.sampleAll);
  if (!p) return;
  const W = e.doc.width,
    H = e.doc.height;
  let { hole, box, img } = p;
  let custom: Mask8 | undefined;
  let tool: 'add' | 'subtract' = 'add';
  let brush = Math.max(10, Math.round(Math.max(W, H) / 40));
  const ws = openWorkspace(
    'Context Fill',
    'cf-workspace',
    `<div class="rw-body">
  <div class="rw-tools" role="toolbar" aria-label="Sampling brush">
    <button id="cf-add" class="rw-tool" aria-pressed="true" title="Add to the sampling area (paint)">${svg('plus', 16)}</button>
    <button id="cf-sub" class="rw-tool" aria-pressed="false" title="Subtract from the sampling area (Alt)">${svg('minus', 16)}</button>
    <label class="rw-tool-size" title="Sampling brush size (px)">${svg('circle', 12)}<input id="cf-brush" type="number" min="1" max="2000" value="${brush}" aria-label="Sampling brush size"></label>
  </div>
  <div class="rw-stage">
    <section class="rw-pane"><h3>Sampling area <small>green: used as source · red: area to fill</small></h3><div class="rw-view" id="cf-left"></div></section>
    <section class="rw-pane"><h3>Preview <small id="cf-status" role="status"></small></h3><div class="rw-view" id="cf-right"></div></section>
  </div>
  <aside class="rw-side">
    <h4>Sampling Area Options</h4>
    ${field('Sampling area', options('cf-sampling', s.sampling, [['auto', 'Auto'], ['rect', 'Rectangular'], ['custom', 'Custom (paint)']]), 'Paint on the left image to customize the area.')}
    <label class="rw-check"><input type="checkbox" id="cf-show" ${s.showSampling ? 'checked' : ''}>Show sampling area</label>
    <label class="rw-check"><input type="checkbox" id="cf-all" ${s.sampleAll ? 'checked' : ''}>Sample all layers</label>
    <h4>Fill Settings</h4>
    ${field('Color adaptation', options('cf-color', s.color, [['none', 'None'], ['default', 'Default'], ['high', 'High']]))}
    ${field('Rotation adaptation', options('cf-rotation', s.rotation, [['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['full', 'Full']]))}
    <label class="rw-check"><input type="checkbox" id="cf-scale" ${s.scale ? 'checked' : ''}>Scale</label>
    <label class="rw-check"><input type="checkbox" id="cf-mirror" ${s.mirror ? 'checked' : ''}>Mirror</label>
    <h4>Output Settings</h4>
    ${field('Output to', options('cf-output', s.output, [['current', 'Current Layer'], ['new', 'New Layer'], ['duplicate', 'Duplicate Layer']]))}
  </aside>
</div>
<footer class="rw-footer"><button id="cf-reset" type="button">Reset</button><span class="rw-spacer"></span><button id="cf-cancel" type="button">Cancel</button><button id="cf-ok" type="button" class="primary">OK</button></footer>`,
  );
  const left = new DocView(ws.q('#cf-left'), W, H);
  // The preview zooms in on the filled area.
  const viewRect = () => expandRect(box, Math.round(0.4 * Math.max(box.width, box.height)) + 16, W, H)!;
  let view = viewRect();
  const right = new DocView(ws.q('#cf-right'), view.width, view.height);
  const status = ws.q('#cf-status');
  const sampling = () => (s.sampling === 'custom' ? (custom ??= samplingFor('auto', hole, box)) : samplingFor(s.sampling, hole, box));
  let base: OffscreenCanvas | undefined;
  const drawLeft = () => {
    const ctx = left.ctx;
    if (!base) {
      base = new OffscreenCanvas(left.canvas.width, left.canvas.height);
      drawImage(base.getContext('2d')!, img);
    }
    ctx.clearRect(0, 0, left.canvas.width, left.canvas.height);
    ctx.drawImage(base, 0, 0);
    const w = left.canvas.width,
      h = left.canvas.height,
      over = new ImageData(w, h);
    const samp = s.showSampling ? sampling() : undefined;
    for (let y = 0; y < h; y++) {
      const dy = Math.min(H - 1, Math.floor((y + 0.5) / left.scale));
      for (let x = 0; x < w; x++) {
        const i = dy * W + Math.min(W - 1, Math.floor((x + 0.5) / left.scale)),
          o = (y * w + x) * 4;
        if (hole.data[i] >= 128) over.data.set([230, 60, 60, 120], o);
        else if (samp?.data[i]) over.data.set([40, 200, 90, 95], o);
      }
    }
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d')!.putImageData(over, 0, 0);
    ctx.drawImage(oc, 0, 0);
  };
  const drawRight = (fill?: Fill) => {
    const ctx = right.ctx;
    drawImage(ctx, cropRGBA(img, view));
    if (!fill) return;
    const R = fill.R,
      sx = right.canvas.width / view.width;
    drawImage(ctx, fill.result, (R.x - view.x) * sx, (R.y - view.y) * sx, R.width * sx, R.height * sx);
  };
  let current: { key: string; fill: Fill } | undefined;
  let running: AbortController | undefined;
  let timer = 0;
  const key = () => JSON.stringify({ ...s, showSampling: 0, output: 0, c: s.sampling === 'custom' ? customVersion : 0 });
  let customVersion = 0;
  const refresh = (delay = 250) => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const k = key();
      if (current?.key === k) return;
      running?.abort();
      const ctrl = new AbortController();
      running = ctrl;
      status.textContent = 'Updating…';
      try {
        const fill = await fillJob(img, hole, box, s, sampling(), (f) => (status.textContent = `Updating… ${Math.round(f * 100)}%`), ctrl.signal);
        if (running !== ctrl) return;
        current = { key: k, fill };
        status.textContent = '';
        drawRight(fill);
      } catch (error) {
        if (error instanceof CancelledError || ctrl.signal.aborted) return;
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        if (running === ctrl) running = undefined;
      }
    }, delay);
  };
  drawLeft();
  drawRight();
  refresh(0);
  // Painting the sampling area switches to Custom.
  let painting: { last: [number, number]; add: boolean } | undefined;
  const stamp = (a: [number, number], b: [number, number], add: boolean) => {
    if (s.sampling !== 'custom') {
      custom = sampling();
      custom = { width: W, height: H, data: new Uint8Array(custom.data) };
      s.sampling = 'custom';
      ws.q<HTMLSelectElement>('#cf-sampling').value = 'custom';
    }
    const r = brush / 2;
    const R = expandRect({ x: Math.min(a[0], b[0]) - r, y: Math.min(a[1], b[1]) - r, width: Math.abs(a[0] - b[0]) + 2 * r, height: Math.abs(a[1] - b[1]) + 2 * r }, 1, W, H);
    if (!R) return;
    const m = strokeMask([a, b], brush, 1, R);
    const c = custom!;
    for (let y = 0; y < R.height; y++)
      for (let x = 0; x < R.width; x++) {
        const v = m.data[y * R.width + x];
        if (!v) continue;
        const i = (y + R.y) * W + x + R.x;
        c.data[i] = add ? Math.max(c.data[i], v >= 128 ? 255 : 0) : v >= 128 ? 0 : c.data[i];
      }
    customVersion++;
  };
  left.canvas.addEventListener('pointerdown', (ev) => {
    left.canvas.setPointerCapture(ev.pointerId);
    const pt = left.point(ev);
    painting = { last: pt, add: tool === 'add' && !ev.altKey };
    stamp(pt, pt, painting.add);
    drawLeft();
  });
  left.canvas.addEventListener('pointermove', (ev) => {
    if (!painting) return;
    const pt = left.point(ev);
    stamp(painting.last, pt, painting.add);
    painting.last = pt;
    drawLeft();
  });
  const endPaint = () => {
    if (!painting) return;
    painting = undefined;
    refresh();
  };
  left.canvas.addEventListener('pointerup', endPaint);
  left.canvas.addEventListener('pointercancel', endPaint);
  const setTool = (t: 'add' | 'subtract') => {
    tool = t;
    ws.q('#cf-add').setAttribute('aria-pressed', String(t === 'add'));
    ws.q('#cf-sub').setAttribute('aria-pressed', String(t === 'subtract'));
  };
  ws.q('#cf-add').addEventListener('click', () => setTool('add'));
  ws.q('#cf-sub').addEventListener('click', () => setTool('subtract'));
  ws.q<HTMLInputElement>('#cf-brush').addEventListener('change', (ev) => (brush = Math.max(1, Math.min(2000, Number((ev.target as HTMLInputElement).value) || brush))));
  const sel = (id: string, k: 'sampling' | 'color' | 'rotation' | 'output', after = () => {}) =>
    ws.q<HTMLSelectElement>(id).addEventListener('change', (ev) => {
      (s as Record<string, unknown>)[k] = (ev.target as HTMLSelectElement).value;
      after();
    });
  sel('#cf-sampling', 'sampling', () => {
    drawLeft();
    refresh();
  });
  sel('#cf-color', 'color', () => refresh());
  sel('#cf-rotation', 'rotation', () => refresh());
  sel('#cf-output', 'output');
  const check = (id: string, k: 'scale' | 'mirror' | 'showSampling' | 'sampleAll', after: () => void) =>
    ws.q<HTMLInputElement>(id).addEventListener('change', (ev) => {
      s[k] = (ev.target as HTMLInputElement).checked;
      after();
    });
  check('#cf-scale', 'scale', () => refresh());
  check('#cf-mirror', 'mirror', () => refresh());
  check('#cf-show', 'showSampling', drawLeft);
  check('#cf-all', 'sampleAll', async () => {
    p = await prepare(e, s.sampleAll);
    if (!p) return;
    ({ hole, box, img } = p);
    base = undefined;
    view = viewRect();
    current = undefined;
    drawLeft();
    drawRight();
    refresh(0);
  });
  ws.q('#cf-reset').addEventListener('click', () => {
    Object.assign(s, defaults);
    custom = undefined;
    for (const [id, v] of [['#cf-sampling', s.sampling], ['#cf-color', s.color], ['#cf-rotation', s.rotation], ['#cf-output', s.output]] as const) ws.q<HTMLSelectElement>(id).value = v;
    for (const [id, v] of [['#cf-scale', s.scale], ['#cf-mirror', s.mirror], ['#cf-show', s.showSampling], ['#cf-all', s.sampleAll]] as const) ws.q<HTMLInputElement>(id).checked = v;
    drawLeft();
    refresh();
  });
  ws.q('#cf-cancel').addEventListener('click', () => {
    running?.abort();
    ws.close();
  });
  let accepted: { ready?: Fill; samp: Mask8 } | undefined;
  ws.q('#cf-ok').addEventListener('click', () => {
    remembered = { ...s, sampling: s.sampling === 'custom' ? 'auto' : s.sampling };
    accepted = { ready: current?.key === key() ? current.fill : undefined, samp: sampling() };
    if (!accepted.ready) running?.abort();
    ws.close();
  });
  ws.dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !(ev.target as HTMLElement).closest('select,input[type=number]')) ws.q('#cf-ok').click();
  });
  await ws.closed;
  clearTimeout(timer);
  if (!accepted) {
    running?.abort();
    return;
  }
  // The command is still running (the editor stays busy), so commit here.
  const fill = accepted.ready ?? (await withFill(e, img, hole, box, s, accepted.samp));
  if (fill) await commitFill(e, fill, s);
}

