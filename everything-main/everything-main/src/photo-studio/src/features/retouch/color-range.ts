// Select > Color Range…: sample colors with the eyedroppers (on the document or
// the preview), tune fuzziness, pick a preset range, localize clusters, invert,
// and preview the selection on the canvas before committing.
import type { Editor } from '../../editor';
import { svg } from '../../app/icons';
import { commitSelectionMask } from '../selection';
import { intersect } from '../../imaging/segment/mask-ops';
import type { Mask8, RGBA8 } from '../../imaging/types';
import { heavy, buffersOf, withProgress } from './client';
import { colorRangeMulti, downscaleImage, fitSize, type ColorRangeSettings, type Pt } from './logic';
import { imageURL, mergedImage, selectionMask } from './source';
import { bindRanges, drawImage, field, openWorkspace, options, range } from './workspace';

type PreviewMode = 'none' | 'grayscale' | 'black' | 'white' | 'quickmask';
let overlay: { url: string; w: number; h: number } | undefined;
const presets: [string, string][] = [
  ['sampled', 'Sampled Colors'],
  ['reds', 'Reds'],
  ['yellows', 'Yellows'],
  ['greens', 'Greens'],
  ['cyans', 'Cyans'],
  ['blues', 'Blues'],
  ['magentas', 'Magentas'],
  ['highlights', 'Highlights'],
  ['midtones', 'Midtones'],
  ['shadows', 'Shadows'],
  ['skin', 'Skin Tones'],
];
let remembered: Pick<ColorRangeSettings, 'fuzziness' | 'localized' | 'rangePct' | 'range' | 'invert'> & { preview: PreviewMode } = { fuzziness: 40, localized: false, rangePct: 25, range: 'sampled', invert: false, preview: 'none' };

/** Preview rendering of a mask for the canvas overlay. */
function previewImage(img: RGBA8, m: Mask8, mode: PreviewMode): RGBA8 | undefined {
  if (mode === 'none') return;
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < m.data.length; i++) {
    const k = m.data[i] / 255,
      o = i * 4;
    if (mode === 'grayscale') out.set([m.data[i], m.data[i], m.data[i], 255], o);
    else if (mode === 'quickmask') out.set([255, 0, 0, Math.round((1 - k) * 128)], o);
    else {
      const bg = mode === 'white' ? 255 : 0;
      for (let c = 0; c < 3; c++) out[o + c] = img.data[o + c] * k + bg * (1 - k);
      out[o + 3] = 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export async function openColorRange(e: Editor) {
  const full = await withProgress(e, 'Reading the image', () => mergedImage(e));
  if (!full) return;
  const W = full.width,
    H = full.height;
  const [pw, ph] = fitSize(W, H, 720);
  const proxy = downscaleImage(full, pw, ph);
  const sx = pw / W;
  const s: ColorRangeSettings = { ...remembered, add: [], addColors: [], subtract: [], subtractColors: [] };
  let preview: PreviewMode = remembered.preview;
  let mode: 'sample' | 'add' | 'subtract' = 'sample';
  let show: 'selection' | 'image' = 'selection';
  const ws = openWorkspace(
    'Color Range',
    'cr-workspace',
    `<div class="cr-body">
  ${field('Select', options('cr-range', s.range, presets))}
  <div class="cr-droppers" role="group" aria-label="Eyedropper">
    <button id="cr-sample" class="rw-tool" aria-pressed="true" title="Sample a color (click the image or preview)">${svg('pipette', 16)}</button>
    <button id="cr-add" class="rw-tool" aria-pressed="false" title="Add to sample (Shift-click)">${svg('pipette', 16)}<span>+</span></button>
    <button id="cr-subtract" class="rw-tool" aria-pressed="false" title="Subtract from sample (Alt-click)">${svg('pipette', 16)}<span>−</span></button>
    <span id="cr-swatches" class="cr-swatches" aria-label="Sampled colors"></span>
  </div>
  <label class="rw-check"><input type="checkbox" id="cr-local" ${s.localized ? 'checked' : ''}>Localized Color Clusters</label>
  ${field('Fuzziness', range('cr-fuzz', 0, 200, s.fuzziness))}
  ${field('Range (%)', range('cr-rangepct', 1, 100, s.rangePct))}
  <div class="cr-preview-box"><canvas id="cr-canvas" width="${pw}" height="${ph}" aria-label="Selection preview; click to sample"></canvas></div>
  <div class="cr-show" role="radiogroup" aria-label="Preview shows"><label><input type="radio" name="cr-show" value="selection" checked>Selection</label><label><input type="radio" name="cr-show" value="image">Image</label></div>
  ${field('Selection preview', options('cr-preview', preview, [['none', 'None'], ['grayscale', 'Grayscale'], ['black', 'Black Matte'], ['white', 'White Matte'], ['quickmask', 'Quick Mask']]))}
  <label class="rw-check"><input type="checkbox" id="cr-invert" ${s.invert ? 'checked' : ''}>Invert</label>
  <p class="cr-hint" id="cr-hint">Click the image or the preview to sample a color.</p>
</div>
<footer class="rw-footer"><button id="cr-reset" type="button">Reset</button><span class="rw-spacer"></span><button id="cr-cancel" type="button">Cancel</button><button id="cr-ok" type="button" class="primary">OK</button></footer>`,
    { modal: false },
  );
  const canvas = ws.q<HTMLCanvasElement>('#cr-canvas');
  const ctx = canvas.getContext('2d')!;
  let mask: Mask8 | undefined;
  const scaled = (): ColorRangeSettings => ({ ...s, add: s.add.map(([x, y]) => [x * sx, y * sx] as Pt), subtract: s.subtract.map(([x, y]) => [x * sx, y * sx] as Pt) });
  const render = () => {
    const sampled = s.range === 'sampled';
    ws.q('.cr-droppers').classList.toggle('disabled', !sampled);
    ws.q<HTMLInputElement>('#cr-local').disabled = !sampled;
    ws.q<HTMLInputElement>('#cr-rangepct').disabled = !sampled || !s.localized;
    ws.q<HTMLInputElement>('[data-for="cr-rangepct"]').disabled = !sampled || !s.localized;
    ws.q('#cr-hint').textContent = sampled ? (s.addColors.length ? `${s.addColors.length} color${s.addColors.length > 1 ? 's' : ''} sampled${s.subtractColors.length ? `, ${s.subtractColors.length} subtracted` : ''}.` : 'Click the image or the preview to sample a color.') : 'Selects by the chosen range; eyedroppers are off.';
    ws.q('#cr-swatches').innerHTML = [...s.addColors.map((c) => ['+', c] as const), ...s.subtractColors.map((c) => ['−', c] as const)]
      .slice(0, 12)
      .map(([k, c]) => `<span class="cr-swatch" title="${k}" style="background:rgb(${c.join(',')})">${k === '−' ? '−' : ''}</span>`)
      .join('');
    mask = colorRangeMulti(proxy, scaled());
    if (show === 'image') drawImage(ctx, proxy);
    else {
      const g = new ImageData(pw, ph);
      for (let i = 0; i < mask.data.length; i++) g.data.set([mask.data[i], mask.data[i], mask.data[i], 255], i * 4);
      ctx.putImageData(g, 0, 0);
    }
    const p = previewImage(proxy, mask, preview);
    overlay = p ? { url: imageURL(p), w: W, h: H } : undefined;
    e.overlay();
  };
  const sampleAt = (x: number, y: number, how: 'sample' | 'add' | 'subtract') => {
    if (s.range !== 'sampled') return;
    const X = Math.max(0, Math.min(W - 1, Math.floor(x))),
      Y = Math.max(0, Math.min(H - 1, Math.floor(y)));
    const o = (Y * W + X) * 4,
      c: [number, number, number] = [full.data[o], full.data[o + 1], full.data[o + 2]];
    if (how === 'sample') {
      s.addColors = [c];
      s.add = [[X + 0.5, Y + 0.5]];
      s.subtractColors = [];
      s.subtract = [];
    } else if (how === 'add') {
      s.addColors.push(c);
      s.add.push([X + 0.5, Y + 0.5]);
    } else {
      s.subtractColors.push(c);
      s.subtract.push([X + 0.5, Y + 0.5]);
    }
    render();
  };
  const how = (ev: MouseEvent) => (ev.shiftKey ? 'add' : ev.altKey ? 'subtract' : mode);
  canvas.addEventListener('pointerdown', (ev) => {
    const r = canvas.getBoundingClientRect();
    sampleAt(((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H, how(ev));
  });
  // While the dialog is open, clicks on the document sample colors instead of using the tool.
  const viewport = e.el('#viewport');
  const onCanvas = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const [x, y] = e.docPoint(ev.clientX, ev.clientY);
    if (x >= 0 && y >= 0 && x < W && y < H) sampleAt(x, y, how(ev));
  };
  viewport.addEventListener('pointerdown', onCanvas, true);
  viewport.classList.add('retouch-sampling');
  const setMode = (m: typeof mode) => {
    mode = m;
    for (const id of ['sample', 'add', 'subtract']) ws.q(`#cr-${id}`).setAttribute('aria-pressed', String(id === m));
  };
  ws.q('#cr-sample').addEventListener('click', () => setMode('sample'));
  ws.q('#cr-add').addEventListener('click', () => setMode('add'));
  ws.q('#cr-subtract').addEventListener('click', () => setMode('subtract'));
  ws.q<HTMLSelectElement>('#cr-range').addEventListener('change', (ev) => {
    s.range = (ev.target as HTMLSelectElement).value as ColorRangeSettings['range'];
    render();
  });
  ws.q<HTMLSelectElement>('#cr-preview').addEventListener('change', (ev) => {
    preview = (ev.target as HTMLSelectElement).value as PreviewMode;
    render();
  });
  ws.q<HTMLInputElement>('#cr-local').addEventListener('change', (ev) => {
    s.localized = (ev.target as HTMLInputElement).checked;
    render();
  });
  ws.q<HTMLInputElement>('#cr-invert').addEventListener('change', (ev) => {
    s.invert = (ev.target as HTMLInputElement).checked;
    render();
  });
  ws.dialog.querySelectorAll<HTMLInputElement>('input[name="cr-show"]').forEach((r) =>
    r.addEventListener('change', () => {
      show = r.value as typeof show;
      render();
    }),
  );
  let frame = 0;
  bindRanges(ws.dialog, (id, v) => {
    if (id === 'cr-fuzz') s.fuzziness = v;
    else s.rangePct = v;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  ws.q('#cr-reset').addEventListener('click', () => {
    Object.assign(s, { fuzziness: 40, localized: false, rangePct: 25, range: 'sampled', invert: false, add: [], addColors: [], subtract: [], subtractColors: [] });
    ws.q<HTMLSelectElement>('#cr-range').value = 'sampled';
    ws.q<HTMLInputElement>('#cr-local').checked = false;
    ws.q<HTMLInputElement>('#cr-invert').checked = false;
    for (const [id, v] of [['cr-fuzz', 40], ['cr-rangepct', 25]] as const) {
      ws.q<HTMLInputElement>(`#${id}`).value = String(v);
      ws.q<HTMLInputElement>(`[data-for="${id}"]`).value = String(v);
    }
    render();
  });
  let accepted = false;
  ws.q('#cr-cancel').addEventListener('click', ws.close);
  ws.q('#cr-ok').addEventListener('click', () => {
    accepted = true;
    ws.close();
  });
  ws.dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !(ev.target as HTMLElement).closest('select,button')) ws.q('#cr-ok').click();
    if (ev.key === 'Escape') ws.close();
  });
  render();
  await ws.closed;
  viewport.removeEventListener('pointerdown', onCanvas, true);
  viewport.classList.remove('retouch-sampling');
  overlay = undefined;
  e.overlay();
  if (!accepted) return;
  remembered = { fuzziness: s.fuzziness, localized: s.localized, rangePct: s.rangePct, range: s.range, invert: s.invert, preview };
  if (s.range === 'sampled' && !s.addColors.length) {
    e.message('No colors were sampled.');
    return;
  }
  // Full resolution; small images skip the worker round trip.
  let result: Mask8 | undefined;
  if (W * H <= 1_000_000) result = colorRangeMulti(full, s);
  else {
    const img = { width: W, height: H, data: new Uint8ClampedArray(full.data) };
    result = await heavy<Mask8>(e, 'Color Range', 'color-range', { img, settings: s }, buffersOf(img));
  }
  if (!result) return;
  // An existing selection limits the range.
  const sel = selectionMask(e);
  if (sel) result = intersect(result, sel);
  if (!result.data.some((v) => v >= 128)) e.message('No pixels are more than 50% selected; the selection edges will not be visible.');
  commitSelectionMask(e, result, 'replace', 'Color Range');
}
/** Live preview drawn over the canvas while the dialog is open. */
export function previewOverlay() {
  return overlay ? `<image href="${overlay.url}" x="0" y="0" width="${overlay.w}" height="${overlay.h}" preserveAspectRatio="none"/>` : '';
}
