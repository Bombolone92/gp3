// Edit → Auto-Align Layers and Edit → Auto-Blend Layers on the selected
// layers. Alignment keeps embedded image layers non-destructive whenever the
// result is a plain move, rotation or uniform scale; perspective and
// cylindrical results resample pixels. Blending writes layer masks (seams or
// focus regions) so the result stays editable, and optionally bakes a smooth
// tone correction into the pixels.
import type { Editor } from '../../editor';
import { findLayer, type Layer, type PhotoDocument } from '../../model/document';
import { layerLock } from '../../model/locks';
import { clearToPixelLayer, setLayerPixels } from '../../model/pixel-layer';
import { emptyGrid, gridDocBounds, readMask, readRGBA, writeRect, type TileGrid } from '../../model/tiles';
import { canvasRect } from '../../model/selection';
import { mask8, rgba8, type IRect, type Mask8, type RGBA8 } from '../../imaging/types';
import type { Mat3 } from '../../imaging/filters/warp';
import { placementBounds, type AlignResult, type Placement, type Projection } from '../../imaging/stitch/align';
import type { BlendResult } from '../../imaging/stitch/blend';
import { formDialog } from '../../ui/dialog';
import { layerRGBA } from '../pixels';
import { runJob, withTask } from './client';
import { copyImage } from './sources';
import { recordStep } from '../filters/record';

import { ALIGNABLE, canStack } from './stackable';
export { canStack };

/** Selected layers that can take part, bottom to top in document order. */
export function stackLayers(e: Editor): Layer[] {
  const ids = new Set(e.selectedLayers.map((l) => l.id));
  const out: Layer[] = [];
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (ids.has(l.id) && ALIGNABLE.has(l.kind)) out.push(l);
      else walk(l.children);
    }
  };
  walk(e.doc.layers);
  return out;
}

/** Pixels of a layer alone at document size, without its mask or opacity. */
export function plainPixels(e: Editor, l: Layer): Promise<RGBA8> {
  const plain: Layer = { ...l, visible: true, opacity: 1, fillOpacity: 1, blend: 'normal', clipped: false, style: undefined, maskGrid: undefined, mask: null, maskAsset: undefined, pixelMask: undefined, maskStrokes: undefined, maskDisabled: false, maskInverted: false };
  return layerRGBA(e, plain);
}

function assertUnlocked(e: Editor, layers: Layer[]) {
  const locked = layers.find((l) => layerLock(e.doc.layers, l.id, 'all') || layerLock(e.doc.layers, l.id, 'position') || layerLock(e.doc.layers, l.id, 'pixels'));
  if (locked) throw new Error(`Unlock “${locked.name}” first.`);
}

/** A placement that is a similarity (move, rotate, uniform scale). */
function similarity(p: Placement): { k: number; angle: number; m: Mat3 } | null {
  if (p.kind !== 'matrix') return null;
  const m = p.m;
  if (Math.abs(m[6]) > 1e-9 || Math.abs(m[7]) > 1e-9) return null;
  const a = m[0],
    b = m[3];
  if (Math.abs(m[4] - a) > 1e-4 * Math.max(1, Math.abs(a)) || Math.abs(m[1] + b) > 1e-4 * Math.max(1, Math.abs(b))) return null;
  return { k: Math.hypot(a, b), angle: (Math.atan2(b, a) * 180) / Math.PI, m };
}

const isIdentity = (p: Placement) => p.kind === 'matrix' && Math.abs(p.m[0] - 1) < 1e-6 && Math.abs(p.m[4] - 1) < 1e-6 && Math.abs(p.m[1]) < 1e-6 && Math.abs(p.m[3]) < 1e-6 && Math.abs(p.m[2]) < 0.01 && Math.abs(p.m[5]) < 0.01 && !p.m[6] && !p.m[7];

/** Clear the fields of a layer that becomes a plain pixel layer. */
export function toPixelLayer(l: Layer, grid: TileGrid, doc: Pick<PhotoDocument, 'width' | 'height'>) {
  const name = l.name;
  clearToPixelLayer(l);
  setLayerPixels(l, grid, doc);
  l.name = name;
}

type AlignEdit = { id: string; transform?: Layer['transform']; pixels?: TileGrid; mask?: TileGrid | null };

export async function autoAlign(e: Editor, arg?: unknown) {
  const layers = stackLayers(e);
  if (layers.length < 2) return e.message('Select two or more pixel or embedded image layers.');
  assertUnlocked(e, layers);
  let projection = (arg as { params?: { projection?: Projection } } | undefined)?.params?.projection;
  if (!projection) {
    const v = await formDialog(
      'Auto-Align Layers',
      [{ name: 'projection', label: 'Projection', type: 'select', value: 'auto', options: [['auto', 'Auto'], ['perspective', 'Perspective'], ['cylindrical', 'Cylindrical'], ['reposition', 'Reposition only']] }],
      'Align',
      'Matches overlapping content and moves, rotates or reshapes the selected layers to line up with the most connected one.',
    );
    if (!v) return;
    projection = v.projection as Projection;
    recordStep(e, 'edit.auto-align', { params: { projection } });
  }
  const doc = e.doc;
  const tiles = e.assets.tiles;
  const edits = await withTask(e, 'Aligning layers', async (job) => {
    const images = await Promise.all(layers.map((l) => plainPixels(e, l)));
    const result = await runJob<AlignResult>(job, 'align', { images, opts: { projection } }, [0, 0.6]);
    if (result.aligned.filter(Boolean).length < 2) throw new Error('No overlapping content was found between the selected layers.');
    const out: AlignEdit[] = [];
    const warps: { index: number; target: 'pixels' | 'mask'; image: RGBA8; placement: Placement; rect: IRect; offset: { x: number; y: number } }[] = [];
    layers.forEach((l, i) => {
      const p = result.placements[i];
      if (!result.aligned[i] || isIdentity(p)) return;
      const s = similarity(p);
      if (l.kind === 'image' && s) {
        // Compose the similarity with the embedded object's own transform.
        const t = l.transform;
        const cx = t.x + t.width / 2,
          cy = t.y + t.height / 2;
        const nx = s.m[0] * cx + s.m[1] * cy + s.m[2],
          ny = s.m[3] * cx + s.m[4] * cy + s.m[5];
        const w = t.width * s.k,
          h = t.height * s.k;
        const edit: AlignEdit = { id: l.id, transform: { x: nx - w / 2, y: ny - h / 2, width: w, height: h, rotation: t.rotation + s.angle } };
        if (l.maskGrid) {
          const mb = gridDocBounds(l.maskGrid) ?? canvasRect(doc);
          warps.push({ index: out.length, target: 'mask', image: maskImage(readMask(tiles, l.maskGrid, mb)), placement: p, rect: placementBounds(p, mb), offset: { x: mb.x, y: mb.y } });
        }
        out.push(edit);
        return;
      }
      // Pixel content (embedded objects are rasterized at document size).
      const content = l.kind === 'pixel' && l.pixels ? gridDocBounds(l.pixels) : canvasRect(doc);
      if (!content) return;
      const image = l.kind === 'pixel' && l.pixels ? readRGBA(tiles, l.pixels, content) : images[i];
      out.push({ id: l.id });
      warps.push({ index: out.length - 1, target: 'pixels', image: copyImage(image), placement: p, rect: placementBounds(p, content), offset: { x: content.x, y: content.y } });
      if (l.maskGrid) {
        const mb = gridDocBounds(l.maskGrid) ?? canvasRect(doc);
        warps.push({ index: out.length - 1, target: 'mask', image: maskImage(readMask(tiles, l.maskGrid, mb)), placement: p, rect: placementBounds(p, mb), offset: { x: mb.x, y: mb.y } });
      }
    });
    if (!warps.length) return out;
    // Warp everything in one job; the order of results follows `warps`.
    const results = await runJob<RGBA8[]>(job, 'warp', { items: warps.map((w) => ({ image: w.image, placement: w.placement, rect: w.rect, offset: w.offset })) }, [0.6, 1]);
    warps.forEach((w, k) => {
      const edit = out[w.index];
      if (w.target === 'mask') edit.mask = writeRect(tiles, emptyGrid(1), w.rect.x, w.rect.y, fromMaskImage(results[k]));
      else edit.pixels = writeRect(tiles, emptyGrid(4), w.rect.x, w.rect.y, results[k]);
    });
    return out;
  });
  if (!edits) return;
  e.command('Auto-Align Layers', (d) => {
    for (const ed of edits) {
      const l = findLayer(d.layers, ed.id);
      if (!l) continue;
      if (ed.transform) l.transform = ed.transform;
      if (ed.pixels) {
        if (l.kind === 'pixel') setLayerPixels(l, ed.pixels, d);
        else toPixelLayer(l, ed.pixels, d);
      }
      if (ed.mask !== undefined) l.maskGrid = ed.mask ?? undefined;
    }
  });
  const rasterized = edits.filter((x) => x.pixels && layers.find((l) => l.id === x.id)?.kind === 'image').length;
  e.message(`Aligned ${edits.length} layer${edits.length === 1 ? '' : 's'}${rasterized ? `; ${rasterized} embedded object${rasterized > 1 ? 's were' : ' was'} rasterized for the projection` : ''}.`);
}

/** Masks travel through the RGBA warper as gray images with full alpha. */
function maskImage(m: Mask8): RGBA8 {
  const img = rgba8(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) img.data.set([m.data[i], m.data[i], m.data[i], 255], i * 4);
  return img;
}
function fromMaskImage(img: RGBA8): Mask8 {
  const m = mask8(img.width, img.height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = Math.round((img.data[i * 4] * img.data[i * 4 + 3]) / 255);
  return m;
}

/** Alpha bounds of a document-size image (null when empty). */
function alphaRect(img: RGBA8): IRect | null {
  let x0 = img.width,
    y0 = img.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
function cropImage(img: RGBA8, r: IRect): RGBA8 {
  const out = rgba8(r.width, r.height);
  for (let y = 0; y < r.height; y++) out.data.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.width) * 4), y * r.width * 4);
  return out;
}

export type BlendMethod = 'panorama' | 'stack';

export async function autoBlend(e: Editor, arg?: unknown) {
  const layers = stackLayers(e);
  if (layers.length < 2) return e.message('Select two or more pixel or embedded image layers.');
  assertUnlocked(e, layers);
  let o = (arg as { params?: { method?: BlendMethod; seamless?: boolean } } | undefined)?.params;
  if (!o?.method) {
    const v = await formDialog(
      'Auto-Blend Layers',
      [
        { name: 'method', label: 'Blend method', type: 'select', value: 'panorama', options: [['panorama', 'Panorama (seams between overlaps)'], ['stack', 'Stack images (sharpest areas)']] },
        { name: 'seamless', label: 'Seamless tones and colors', type: 'checkbox', value: 'yes' },
      ],
      'Blend',
      'Adds a layer mask to each selected layer. Seamless tones adjust pixels near the seams so exposure differences disappear.',
    );
    if (!v) return;
    o = { method: v.method as BlendMethod, seamless: v.seamless === 'yes' };
    recordStep(e, 'edit.auto-blend', { params: o });
  }
  const method = o.method!,
    seamless = o.seamless !== false;
  const doc = e.doc;
  const tiles = e.assets.tiles;
  const done = await withTask(e, method === 'stack' ? 'Blending stack' : 'Blending layers', async (job) => {
    const images = await Promise.all(layers.map((l) => plainPixels(e, l)));
    if (method === 'stack') {
      const r = await runJob<BlendResult>(job, 'blend-stack', { images: images.map(copyImage), seamless });
      return layers.map((l, i) => ({ id: l.id, rect: canvasRect(doc), mask: r.masks[i], image: seamless && r.images[i] !== images[i] ? r.images[i] : undefined }));
    }
    const rects = images.map(alphaRect);
    const keep = layers.map((_, i) => i).filter((i) => rects[i]);
    const items = keep.map((i) => ({ image: cropImage(images[i], rects[i]!), x: rects[i]!.x, y: rects[i]!.y }));
    const r = await runJob<BlendResult>(job, 'blend-panorama', { items, canvas: canvasRect(doc), seamless });
    return keep.map((i, k) => ({ id: layers[i].id, rect: rects[i]!, mask: r.masks[k], image: seamless ? r.images[k] : undefined }));
  });
  if (!done) return;
  // Build grids before the history step.
  const edits = done.map((d) => {
    const l = layers.find((x) => x.id === d.id)!;
    const mask = writeRect(tiles, emptyGrid(1), d.rect.x, d.rect.y, d.mask);
    let pixels: TileGrid | undefined;
    if (d.image) {
      const base = l.kind === 'pixel' && l.pixels ? l.pixels : emptyGrid(4);
      // Embedded objects become pixels at document size; pixel layers keep
      // their off-canvas content and only change where the correction applies.
      pixels = l.kind === 'pixel' ? writeRect(tiles, base, d.rect.x, d.rect.y, d.image) : writeRect(tiles, emptyGrid(4), d.rect.x, d.rect.y, d.image);
    }
    return { id: d.id, mask, pixels };
  });
  e.command('Auto-Blend Layers', (d) => {
    for (const ed of edits) {
      const l = findLayer(d.layers, ed.id);
      if (!l) continue;
      l.maskGrid = ed.mask;
      delete l.maskDisabled;
      delete l.maskInverted;
      l.mask = null;
      delete l.maskAsset;
      delete l.pixelMask;
      delete l.maskStrokes;
      if (ed.pixels) {
        if (l.kind === 'pixel') setLayerPixels(l, ed.pixels, d);
        else toPixelLayer(l, ed.pixels, d);
      }
    }
  });
  e.message(method === 'stack' ? 'Blended the stack with focus masks.' : 'Blended the layers with seam masks.');
}
