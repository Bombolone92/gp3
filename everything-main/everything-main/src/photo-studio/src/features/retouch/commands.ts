// Select menu (Subject, Sky), Layer > Remove Background and Layer > Matting.
import type { Editor } from '../../editor';
import { commitSelectionMask } from '../selection';
import { commitTarget, layerRGBA, roundIRect } from '../pixels';
import { formDialog } from '../../ui/dialog';
import { findLayer } from '../../model/document';
import { canvasRect } from '../../model/selection';
import { readMask, readRGBA, writeRect } from '../../model/tiles';
import { layerLock } from '../../model/locks';
import type { Mask8, RGBA8 } from '../../imaging/types';
import { heavy } from './client';
import { decontaminateLayer, defringe, expandRect, removeMatte } from './logic';
import { mergedImage, retouchTarget } from './source';

const copy = (img: RGBA8): RGBA8 => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const empty = (m: Mask8) => !m.data.some((v) => v > 0);

export async function selectSubject(e: Editor) {
  const mask = await heavy<Mask8>(e, 'Selecting subject', 'subject', async () => ({ img: copy(await mergedImage(e)) }));
  if (!mask) return;
  if (empty(mask)) {
    e.message('No distinct subject was found. Try Object Selection around it.');
    return;
  }
  commitSelectionMask(e, mask, 'replace', 'Select Subject');
}
export async function selectSky(e: Editor) {
  const mask = await heavy<Mask8>(e, 'Selecting sky', 'sky', async () => ({ img: copy(await mergedImage(e)) }));
  if (!mask) return;
  if (empty(mask)) {
    e.message('No sky was found along the top of the image.');
    return;
  }
  commitSelectionMask(e, mask, 'replace', 'Select Sky');
}
/** Non-destructive background removal: the subject becomes the layer mask. */
export async function removeBackground(e: Editor) {
  const l = e.layer;
  if (!l || l.kind === 'group' || l.kind === 'adjustment') {
    e.message('Select an image layer first.');
    return;
  }
  if (layerLock(e.doc.layers, l.id, 'all')) {
    e.message('Unlock this layer to add a mask.');
    return;
  }
  const mask = await heavy<Mask8>(e, 'Removing background', 'subject', async () => ({ img: copy(await layerRGBA(e, { ...l, maskGrid: undefined, mask: null, opacity: 1 })) }));
  if (!mask) return;
  if (empty(mask)) {
    e.message('No distinct subject was found on this layer.');
    return;
  }
  const store = e.assets.tiles;
  if (l.maskGrid) {
    // Keep whatever the existing mask already hides.
    const old = readMask(store, l.maskGrid, canvasRect(e.doc));
    for (let i = 0; i < mask.data.length; i++) mask.data[i] = Math.round((mask.data[i] * old.data[i]) / 255);
  }
  const grid = writeRect(store, { channels: 1, x: 0, y: 0, tiles: {}, bounds: null }, 0, 0, mask);
  const id = l.id;
  e.command('Remove Background', (d) => {
    const t = findLayer(d.layers, id);
    if (!t) return;
    t.mask = null;
    delete t.maskAsset;
    delete t.pixelMask;
    delete t.maskStrokes;
    delete t.maskDisabled;
    delete t.maskInverted;
    t.maskGrid = grid;
  });
  e.maskTarget = '';
  e.message('Background hidden with a layer mask. Paint the mask to adjust it.');
}

async function matting(e: Editor, label: string, fn: (img: RGBA8) => RGBA8) {
  const target = await retouchTarget(e, label);
  if (!target) return;
  const g = target.grid;
  if (!g.bounds) {
    e.message('The layer is empty.');
    return;
  }
  const b = expandRect(roundIRect({ x: g.bounds.x + g.x, y: g.bounds.y + g.y, width: g.bounds.width, height: g.bounds.height }), 2, e.doc.width, e.doc.height);
  if (!b) return;
  const src = readRGBA(e.assets.tiles, g, b);
  commitTarget(e, target, writeRect(e.assets.tiles, g, b.x, b.y, fn(src)), label);
}

/** Layer → Matting: Defringe, Color Decontaminate, Remove Black/White Matte. */
export async function runMatting(e: Editor, kind: 'defringe' | 'decontaminate' | 'black' | 'white') {
  if (kind === 'defringe') {
    const v = await formDialog('Defringe', [{ name: 'width', label: 'Width (px)', value: 1, type: 'number', min: 1, max: 200 }], 'OK');
    if (v) await matting(e, 'Defringe', (img) => defringe(img, Number(v.width)));
  } else if (kind === 'decontaminate') {
    const v = await formDialog('Color Decontaminate', [{ name: 'amount', label: 'Amount (%)', value: 100, type: 'number', min: 1, max: 100 }], 'OK');
    if (v) await matting(e, 'Color Decontaminate', (img) => decontaminateLayer(img, Number(v.amount) / 100));
  } else await matting(e, kind === 'black' ? 'Remove Black Matte' : 'Remove White Matte', (img) => removeMatte(img, kind));
}
