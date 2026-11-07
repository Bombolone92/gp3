// Select > Focus Area…: select the in-focus parts of the image from local
// sharpness (imaging/segment/focus-area). The preview runs on a reduced copy;
// OK computes the full-resolution mask in the retouching worker.
import type { Editor } from '../../editor';
import { commands } from '../../app/registry';
import { commitSelectionMask } from '../selection';
import { autoFocusRange, focusAreaMask, type FocusAreaOptions } from '../../imaging/segment/focus-area';
import { intersect } from '../../imaging/segment/mask-ops';
import type { Mask8, RGBA8 } from '../../imaging/types';
import { buffersOf, heavy, withProgress } from './client';
import { downscaleImage, fitSize } from './logic';
import { imageURL, mergedImage, selectionMask } from './source';
import { bindRanges, drawImage, field, openWorkspace, options, range } from './workspace';
import './focus-area.css';

type View = 'quickmask' | 'black' | 'white' | 'mask' | 'none';
type Output = 'selection' | 'mask' | 'layer' | 'layer-mask';
let overlay: { url: string; w: number; h: number } | undefined;
let remembered: { range: number; auto: boolean; noise: number; soften: boolean; view: View; output: Output } = { range: 50, auto: true, noise: 0, soften: true, view: 'quickmask', output: 'selection' };

function viewImage(img: RGBA8, m: Mask8, view: View): RGBA8 | undefined {
  if (view === 'none') return;
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < m.data.length; i++) {
    const k = m.data[i] / 255,
      o = i * 4;
    if (view === 'mask') out.set([m.data[i], m.data[i], m.data[i], 255], o);
    else if (view === 'quickmask') out.set([255, 0, 0, Math.round((1 - k) * 130)], o);
    else {
      const bg = view === 'white' ? 255 : 0;
      for (let c = 0; c < 3; c++) out[o + c] = img.data[o + c] * k + bg * (1 - k);
      out[o + 3] = 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export async function openFocusArea(e: Editor) {
  const full = await withProgress(e, 'Reading the image', () => mergedImage(e));
  if (!full) return;
  const W = full.width,
    H = full.height;
  const [pw, ph] = fitSize(W, H, 640);
  const proxy = downscaleImage(full, pw, ph);
  const s = { ...remembered };
  // The proxy is smaller, so its sharpness reads like a less noisy image.
  if (s.auto) s.range = autoFocusRange(proxy, s.noise);
  const ws = openWorkspace(
    'Focus Area',
    'cr-workspace fa-workspace',
    `<div class="cr-body">
  <div class="fa-range">${field('In-Focus Range', range('fa-range', 0, 100, s.range), 'Higher values include softer areas.')}<label class="rw-check"><input type="checkbox" id="fa-auto" ${s.auto ? 'checked' : ''}>Auto</label></div>
  ${field('Image Noise Level', range('fa-noise', 0, 100, s.noise), 'Raise for grainy or high-ISO images.')}
  <label class="rw-check"><input type="checkbox" id="fa-soften" ${s.soften ? 'checked' : ''}>Soften Edges</label>
  <div class="cr-preview-box"><canvas id="fa-canvas" width="${pw}" height="${ph}" aria-label="Focus area preview"></canvas></div>
  ${field('View', options('fa-view', s.view, [['quickmask', 'Overlay'], ['black', 'On Black'], ['white', 'On White'], ['mask', 'Black & White'], ['none', 'Off']]))}
  ${field('Output To', options('fa-output', s.output, [['selection', 'Selection'], ['mask', 'Layer Mask'], ['layer', 'New Layer'], ['layer-mask', 'New Layer with Layer Mask']]))}
  <p class="cr-hint" id="fa-hint"></p>
</div>
<footer class="rw-footer"><button id="fa-reset" type="button">Reset</button><span class="rw-spacer"></span><button id="fa-cancel" type="button">Cancel</button><button id="fa-ok" type="button" class="primary">OK</button></footer>`,
    { modal: false },
  );
  const canvas = ws.q<HTMLCanvasElement>('#fa-canvas');
  const ctx = canvas.getContext('2d')!;
  const opts = (): FocusAreaOptions => ({ range: s.range, noise: s.noise, softenEdges: s.soften });
  const setRange = (v: number) => {
    s.range = v;
    ws.q<HTMLInputElement>('#fa-range').value = String(v);
    ws.q<HTMLInputElement>('[data-for="fa-range"]').value = String(v);
  };
  const render = () => {
    const mask = focusAreaMask(proxy, opts());
    // The dialog always shows the result: the overlay over the image, or the chosen matte.
    const shown = viewImage(proxy, mask, s.view === 'none' ? 'quickmask' : s.view);
    if (s.view === 'quickmask' || s.view === 'none') drawImage(ctx, proxy);
    if (shown) drawImage(ctx, shown);
    const canvasView = viewImage(proxy, mask, s.view);
    overlay = canvasView ? { url: imageURL(canvasView), w: W, h: H } : undefined;
    let n = 0;
    for (const v of mask.data) if (v >= 128) n++;
    ws.q('#fa-hint').textContent = `${Math.round((n / mask.data.length) * 100)}% of the image is in focus.`;
    e.overlay();
  };
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };
  bindRanges(ws.dialog, (id, v) => {
    if (id === 'fa-range') {
      s.range = v;
      s.auto = false;
      ws.q<HTMLInputElement>('#fa-auto').checked = false;
    } else {
      s.noise = v;
      if (s.auto) setRange(autoFocusRange(proxy, s.noise));
    }
    later();
  });
  ws.q<HTMLInputElement>('#fa-auto').addEventListener('change', (ev) => {
    s.auto = (ev.target as HTMLInputElement).checked;
    if (s.auto) setRange(autoFocusRange(proxy, s.noise));
    later();
  });
  ws.q<HTMLInputElement>('#fa-soften').addEventListener('change', (ev) => {
    s.soften = (ev.target as HTMLInputElement).checked;
    later();
  });
  ws.q<HTMLSelectElement>('#fa-view').addEventListener('change', (ev) => {
    s.view = (ev.target as HTMLSelectElement).value as View;
    later();
  });
  ws.q<HTMLSelectElement>('#fa-output').addEventListener('change', (ev) => (s.output = (ev.target as HTMLSelectElement).value as Output));
  ws.q('#fa-reset').addEventListener('click', () => {
    Object.assign(s, { auto: true, noise: 0, soften: true });
    ws.q<HTMLInputElement>('#fa-auto').checked = true;
    ws.q<HTMLInputElement>('#fa-soften').checked = true;
    ws.q<HTMLInputElement>('#fa-noise').value = '0';
    ws.q<HTMLInputElement>('[data-for="fa-noise"]').value = '0';
    setRange(autoFocusRange(proxy, 0));
    later();
  });
  let accepted = false;
  ws.q('#fa-cancel').addEventListener('click', ws.close);
  ws.q('#fa-ok').addEventListener('click', () => {
    accepted = true;
    ws.close();
  });
  ws.dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !(ev.target as HTMLElement).closest('select,button')) ws.q('#fa-ok').click();
    if (ev.key === 'Escape') ws.close();
  });
  render();
  await ws.closed;
  cancelAnimationFrame(frame);
  overlay = undefined;
  e.overlay();
  if (!accepted) return;
  remembered = { ...s };
  const img = { width: W, height: H, data: new Uint8ClampedArray(full.data) };
  let result = W * H <= 600_000 ? focusAreaMask(img, opts()) : await heavy<Mask8>(e, 'Focus Area', 'focus-area', { img, opts: opts() }, buffersOf(img));
  if (!result) return;
  // An existing selection limits the result.
  const sel = selectionMask(e);
  if (sel) result = intersect(result, sel);
  if (!result.data.some((v) => v >= 128)) e.message('No area is in focus at this range; raise the In-Focus Range.');
  commitSelectionMask(e, result, 'replace', 'Focus Area');
  // Other outputs build on the selection with the regular layer commands.
  const then = async (id: string) => commands.get(id)?.run(e);
  if (s.output === 'mask') await then('layer.mask-reveal-selection');
  else if (s.output === 'layer') await then('layer.via-copy');
  else if (s.output === 'layer-mask') {
    await then('layer.duplicate');
    await then('layer.mask-reveal-selection');
  }
}
/** Live preview drawn over the canvas while the dialog is open. */
export function previewOverlay() {
  return overlay ? `<image href="${overlay.url}" x="0" y="0" width="${overlay.w}" height="${overlay.h}" preserveAspectRatio="none"/>` : '';
}
