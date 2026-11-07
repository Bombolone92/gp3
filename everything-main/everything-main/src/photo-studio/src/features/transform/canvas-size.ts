// Image > Canvas Size: grow or shrink the canvas around a 3x3 anchor, with
// relative sizes, units and an extension color for the background layer.
import type { Editor } from '../../editor';
import { cropDocument, type Layer, type PhotoDocument } from '../../model/document';
import { setLayerPixels } from '../../model/pixel-layer';
import { gridDocBounds, readRGBA, writeRect, type TileGrid, type TileStore } from '../../model/tiles';
import type { IRect } from '../../imaging/types';
import { hexRgb } from '../pixels';
import { anchorOffset, formatBytes, fromPixels, imageBytes, toPixels, type LengthUnit } from './math';
import { docPpi, fmt, openDialog, unitOptions } from './dialog';

export type ExtensionColor = 'foreground' | 'background' | 'white' | 'black' | 'gray' | 'other';
/** Areas of the new canvas outside the old one, in old document coordinates. */
export function extensionStrips(ow: number, oh: number, nw: number, nh: number, dx: number, dy: number): IRect[] {
  const x0 = -dx,
    y0 = -dy,
    x1 = nw - dx,
    y1 = nh - dy;
  const out: IRect[] = [];
  const add = (x: number, y: number, w: number, h: number) => {
    if (w > 0 && h > 0) out.push({ x, y, width: w, height: h });
  };
  add(x0, y0, x1 - x0, Math.min(0, y1) - y0); // above
  add(x0, Math.max(oh, y0), x1 - x0, y1 - Math.max(oh, y0)); // below
  const top = Math.max(0, y0),
    bottom = Math.min(oh, y1);
  add(x0, top, Math.min(0, x1) - x0, bottom - top); // left
  add(Math.max(ow, x0), top, x1 - Math.max(ow, x0), bottom - top); // right
  return out;
}
/** The bottom pixel layer acts as a background when it is named so or
 * covers the whole canvas. */
export function backgroundLayer(doc: PhotoDocument): Layer | undefined {
  const l = doc.layers[0];
  if (!l || l.kind !== 'pixel' || !l.pixels) return;
  const b = gridDocBounds(l.pixels);
  if (l.name === 'Background') return l;
  if (b && b.x <= 0 && b.y <= 0 && b.x + b.width >= doc.width && b.y + b.height >= doc.height) return l;
}
/** Paint `rgb` behind existing pixels in each strip (off-canvas content stays on top). */
export function fillBehind(store: TileStore, grid: TileGrid, strips: IRect[], rgb: [number, number, number]): TileGrid {
  let g = grid;
  for (const r of strips) {
    const img = readRGBA(store, g, r);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      d[i] = d[i] * a + rgb[0] * (1 - a);
      d[i + 1] = d[i + 1] * a + rgb[1] * (1 - a);
      d[i + 2] = d[i + 2] * a + rgb[2] * (1 - a);
      d[i + 3] = 255;
    }
    g = writeRect(store, g, r.x, r.y, img);
  }
  return g;
}
export function resizeCanvas(e: Editor, nw: number, nh: number, dx: number, dy: number, rgb: [number, number, number] | null, label = 'Canvas Size') {
  const doc = e.doc;
  const bg = rgb ? backgroundLayer(doc) : undefined;
  const filled = bg ? fillBehind(e.assets.tiles, bg.pixels!, extensionStrips(doc.width, doc.height, nw, nh, dx, dy), rgb!) : undefined;
  e.command(label, (d) => {
    if (bg && filled) {
      const l = d.layers.find((x) => x.id === bg.id);
      if (l) setLayerPixels(l, filled, d);
    }
    // A rectangle reaching past the canvas enlarges it.
    cropDocument(d, { x: -dx, y: -dy, width: nw, height: nh });
    d.selection = null;
    d.selectionMask = null;
  });
  e.fit();
  e.update();
}

const ARROW = 'M12 19V5M6 11l6-6 6 6';
export async function canvasSizeDialog(e: Editor) {
  e.transform.apply();
  e.modal?.apply();
  const doc = e.doc;
  const ow = doc.width,
    oh = doc.height,
    bits = doc.bitsPerChannel ?? 8,
    ppi = docPpi(doc);
  const saved = (e.settings.canvasSize as { unit?: LengthUnit; relative?: boolean; anchor?: [number, number]; color?: ExtensionColor; other?: string } | undefined) ?? {};
  const st = { unit: saved.unit ?? ('px' as LengthUnit), relative: !!saved.relative, ax: saved.anchor?.[0] ?? 0.5, ay: saved.anchor?.[1] ?? 0.5, color: saved.color ?? ('background' as ExtensionColor), other: saved.other ?? '#808080', w: 0, h: 0 };
  // New size in pixels (absolute).
  st.w = ow;
  st.h = oh;
  const hasBackground = !!backgroundLayer(doc);
  const html = `<form method="dialog" class="canvas-size"><h2>Canvas Size</h2>
    <fieldset class="cs-group"><legend>Current Size: <strong>${formatBytes(imageBytes(ow, oh, bits))}</strong></legend>
      <div class="cs-current"><span>Width:</span><strong data-cs="cw"></strong><span>Height:</span><strong data-cs="ch"></strong></div></fieldset>
    <fieldset class="cs-group"><legend>New Size: <strong data-cs="size"></strong></legend>
      <div class="cs-grid">
        <label for="cs-w">Width</label><input id="cs-w" type="number" step="any" required><select id="cs-unit" aria-label="Unit"></select>
        <label for="cs-h">Height</label><input id="cs-h" type="number" step="any" required><span></span>
      </div>
      <label class="cs-relative"><input id="cs-rel" type="checkbox"> Relative</label>
      <div class="cs-anchor-row"><span>Anchor:</span><div class="cs-anchor" role="radiogroup" aria-label="Anchor"></div></div>
    </fieldset>
    <div class="cs-color"><label for="cs-color">Canvas extension color:</label><select id="cs-color" ${hasBackground ? '' : 'disabled'}>
      ${(['foreground', 'background', 'white', 'black', 'gray', 'other'] as ExtensionColor[]).map((c) => `<option value="${c}">${c === 'gray' ? 'Gray' : c === 'other' ? 'Other…' : c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select>
      <input id="cs-other" type="color" aria-label="Extension color" ${hasBackground ? '' : 'disabled'}></div>
    <p class="cs-note" data-cs="note"></p>
    <div class="dialog-actions"><button type="button" data-dialog-cancel>Cancel</button><button type="submit" class="primary">OK</button></div></form>`;
  const ok = await openDialog(html, 'ts-canvas-size', (form) => {
    const $ = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
    const w = $<HTMLInputElement>('#cs-w'),
      h = $<HTMLInputElement>('#cs-h'),
      unit = $<HTMLSelectElement>('#cs-unit'),
      rel = $<HTMLInputElement>('#cs-rel'),
      color = $<HTMLSelectElement>('#cs-color'),
      other = $<HTMLInputElement>('#cs-other'),
      anchor = $<HTMLDivElement>('.cs-anchor');
    const swatch = () => (st.color === 'foreground' ? e.color : st.color === 'background' ? e.background : st.color === 'white' ? '#ffffff' : st.color === 'black' ? '#000000' : st.color === 'gray' ? '#808080' : st.other);
    const shown = (px: number, base: number) => (st.relative ? fromPixels(px - base, st.unit, ppi, base) : fromPixels(px, st.unit, ppi, base));
    const sync = (except?: HTMLElement) => {
      $('[data-cs="cw"]').textContent = `${fmt(fromPixels(ow, st.unit === 'percent' ? 'px' : st.unit, ppi, ow), st.unit === 'percent' ? 'px' : st.unit)} ${unitLabel(st.unit === 'percent' ? 'px' : st.unit)}`;
      $('[data-cs="ch"]').textContent = `${fmt(fromPixels(oh, st.unit === 'percent' ? 'px' : st.unit, ppi, oh), st.unit === 'percent' ? 'px' : st.unit)} ${unitLabel(st.unit === 'percent' ? 'px' : st.unit)}`;
      if (except !== w) w.value = fmt(shown(st.w, ow), st.unit);
      if (except !== h) h.value = fmt(shown(st.h, oh), st.unit);
      unit.innerHTML = unitOptions(st.unit);
      rel.checked = st.relative;
      color.value = st.color;
      other.value = swatch();
      const nw = Math.round(st.w),
        nh = Math.round(st.h);
      $('[data-cs="size"]').textContent = formatBytes(imageBytes(Math.max(1, nw), Math.max(1, nh), bits));
      const bad = nw < 1 || nh < 1 || nw > 8192 || nh > 8192 || nw * nh > 24_000_000;
      $('[data-cs="note"]').textContent = bad
        ? 'Use dimensions from 1 to 8192 pixels, up to 24 megapixels.'
        : nw < ow || nh < oh
          ? 'The new canvas is smaller: content outside it stays on its layers until you trim or flatten.'
          : hasBackground
            ? ''
            : 'New areas are transparent: there is no background layer to extend.';
      (form.querySelector('[type=submit]') as HTMLButtonElement).disabled = bad;
      // Arrows point from the anchor toward the sides that grow.
      anchor.innerHTML = [0, 0.5, 1]
        .flatMap((y) =>
          [0, 0.5, 1].map((x) => {
            const dx = Math.sign(x - st.ax),
              dy = Math.sign(y - st.ay);
            const here = x === st.ax && y === st.ay;
            const near = Math.abs(x - st.ax) <= 0.5 && Math.abs(y - st.ay) <= 0.5;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
            const glyph = here ? '<span class="cs-dot"></span>' : near ? `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="${ARROW}" transform="rotate(${angle} 12 12)"/></svg>` : '';
            return `<button type="button" role="radio" aria-checked="${here}" data-cs-anchor="${x},${y}" aria-label="Anchor ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'center'}">${glyph}</button>`;
          }),
        )
        .join('');
    };
    const onSize = (axis: 'w' | 'h') => () => {
      const input = axis === 'w' ? w : h;
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      const base = axis === 'w' ? ow : oh;
      const px = st.relative ? base + toPixels(v, st.unit, ppi, base) : toPixels(v, st.unit, ppi, base);
      if (axis === 'w') st.w = px;
      else st.h = px;
      sync(input);
    };
    w.addEventListener('input', onSize('w'));
    h.addEventListener('input', onSize('h'));
    unit.addEventListener('change', () => {
      st.unit = unit.value as LengthUnit;
      sync();
    });
    rel.addEventListener('change', () => {
      st.relative = rel.checked;
      sync();
    });
    color.addEventListener('change', () => {
      st.color = color.value as ExtensionColor;
      sync();
      if (st.color === 'other') other.click();
    });
    other.addEventListener('input', () => {
      st.color = 'other';
      st.other = other.value;
      color.value = 'other';
    });
    anchor.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-cs-anchor]');
      if (!b) return;
      [st.ax, st.ay] = b.dataset.csAnchor!.split(',').map(Number);
      sync();
      form.querySelector<HTMLElement>(`[data-cs-anchor="${st.ax},${st.ay}"]`)?.focus();
    });
    sync();
  });
  if (!ok) return;
  e.settings.canvasSize = { unit: st.unit, relative: st.relative, anchor: [st.ax, st.ay], color: st.color, other: st.other };
  const nw = Math.round(st.w),
    nh = Math.round(st.h);
  if (nw === ow && nh === oh) return;
  const { dx, dy } = anchorOffset(ow, oh, nw, nh, st.ax, st.ay);
  const hex = st.color === 'foreground' ? e.color : st.color === 'background' ? e.background : st.color === 'white' ? '#ffffff' : st.color === 'black' ? '#000000' : st.color === 'gray' ? '#808080' : st.other;
  resizeCanvas(e, nw, nh, dx, dy, hasBackground ? hexRgb(hex) : null);
}
const unitLabel = (u: LengthUnit) => ({ px: 'px', percent: '%', in: 'in', cm: 'cm', mm: 'mm', pt: 'pt' })[u];
