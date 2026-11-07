// File → Automate → Panorama… and File → Automate → Merge to HDR…: load
// several images, align them, then blend them into a layered panorama or merge
// the exposures into a 32-bit (or tone-mapped 8-bit) document.
import type { Editor } from '../../editor';
import type { Mat3 } from '../../imaging/filters/warp';
import { fitOutput, placementBounds, composePlacement, type AlignResult, type Placement, type Projection } from '../../imaging/stitch/align';
import type { BlendResult } from '../../imaging/stitch/blend';
import { DEFAULT_HDR_TONING, type HdrToningParams } from '../../imaging/adjust/hdr-toning';
import { CancelledError, mask8, type IRect, type Mask8, type RGBA8, type RGBAF } from '../../imaging/types';
import { layer } from '../../model/document';
import { emptyGrid, writeRect } from '../../model/tiles';
import { escapeXML } from '../../model/assets';
import { buffersOf, channel } from '../retouch/client';
import { runJob, withTask } from './client';
import { baseName, copyImage, field, imageLayer, inputsDialog, loadImage, openDocument, type Input } from './sources';
import { toningControls } from './hdr-toning';

type PanoramaOptions = { projection: Projection; blend: boolean; fill: boolean };

export async function panoramaDialog(e: Editor) {
  const d = inputsDialog(
    e,
    'Panorama',
    `<section class="processor-step"><h3><span>2</span>Layout</h3>
      <label class="dialog-field">Projection<select name="projection"><option value="auto">Auto</option><option value="perspective">Perspective</option><option value="cylindrical">Cylindrical</option><option value="reposition">Reposition only</option></select></label>
      <label class="dialog-field checkbox-field">Blend images together<input type="checkbox" name="blend" checked></label>
      <label class="dialog-field checkbox-field">Fill transparent edges (Context Fill)<input type="checkbox" name="fill"></label>
    </section>`,
    { submit: 'Create Panorama' },
  );
  if (!(await d.result)) return;
  const o: PanoramaOptions = { projection: field(d.form, 'projection').value as Projection, blend: field(d.form, 'blend').checked, fill: field(d.form, 'fill').checked };
  const inputs = [...d.inputs];
  d.close();
  await createPanorama(e, inputs, o);
}

/** Build a layered panorama document from images. */
export async function createPanorama(e: Editor, inputs: Input[], o: PanoramaOptions) {
  const result = await withTask(e, 'Creating panorama', async (job) => {
    const images: RGBA8[] = [];
    for (const input of inputs) {
      if (job.signal.aborted) throw new CancelledError();
      images.push(await loadImage(e, input));
      job.progress((0.1 * images.length) / inputs.length);
    }
    const aligned = await runJob<AlignResult>(job, 'align', { images: images.map(copyImage), opts: { projection: o.projection } }, [0.1, 0.45]);
    const used = images.map((_, i) => i).filter((i) => aligned.aligned[i]);
    if (used.length < 2) throw new Error('The images do not overlap enough to be aligned.');
    // Place the union of all images at the origin, scaled to the size limits.
    const full = (i: number): IRect => ({ x: 0, y: 0, width: images[i].width, height: images[i].height });
    const bounds = used.map((i) => placementBounds(aligned.placements[i], full(i)));
    const { union, scale } = fitOutput(bounds);
    const t: Mat3 = [scale, 0, -union.x * scale, 0, scale, -union.y * scale, 0, 0, 1];
    const placements: Placement[] = used.map((i) => composePlacement(t, aligned.placements[i]));
    const width = Math.max(1, Math.ceil(union.width * scale)),
      height = Math.max(1, Math.ceil(union.height * scale));
    const rects = used.map((i, k) => clip(placementBounds(placements[k], full(i)), width, height));
    const warped = await runJob<RGBA8[]>(job, 'warp', { items: used.map((i, k) => ({ image: copyImage(images[i]), placement: placements[k], rect: rects[k] })) }, [0.45, 0.75]);
    let masks: Mask8[] | null = null;
    let pixels = warped;
    if (o.blend) {
      const items = warped.map((img, k) => ({ image: copyImage(img), x: rects[k].x, y: rects[k].y }));
      const r = await runJob<BlendResult>(job, 'blend-panorama', { items, canvas: { x: 0, y: 0, width, height }, seamless: true }, [0.75, 0.92]);
      masks = r.masks;
      pixels = r.images;
    }
    let filled: RGBA8 | null = null;
    if (o.fill) {
      // Without blending, layers simply stack in order.
      const shown = masks ?? pixels.map((img) => ({ width: img.width, height: img.height, data: new Uint8Array(img.width * img.height).fill(255) }));
      const merged = mergeMasked(pixels, shown, rects, width, height);
      filled = await fillEdges(merged, job);
    }
    job.progress(1);
    return { width, height, used, rects, pixels, masks, filled, projection: aligned.projection, skipped: images.length - used.length };
  });
  if (!result) return;
  const { width, height, used, rects, pixels, masks, filled } = result;
  await openDocument(e, 'Panorama', width, height, (doc, s) => {
    const layers = used.map((i, k) => {
      const l = imageLayer(s, doc, baseName(inputs[i].name), pixels[k], rects[k].x, rects[k].y);
      if (masks) l.maskGrid = writeRect(s.assets.tiles, emptyGrid(1), rects[k].x, rects[k].y, masks[k]);
      return l;
    });
    if (filled) layers.push(imageLayer(s, doc, 'Panorama (filled)', filled));
    return layers;
  });
  e.message(`Panorama of ${used.length} images (${result.projection === 'similarity' ? 'auto' : result.projection} projection)${result.skipped ? `; ${result.skipped} image${result.skipped > 1 ? 's' : ''} did not overlap and were left out` : ''}.`);
}

function clip(r: IRect, w: number, h: number): IRect {
  const x = Math.max(0, r.x),
    y = Math.max(0, r.y);
  return { x, y, width: Math.max(1, Math.min(w, r.x + r.width) - x), height: Math.max(1, Math.min(h, r.y + r.height) - y) };
}

/** Composite placed layers through their masks (normal blending). */
function mergeMasked(images: RGBA8[], masks: Mask8[], rects: IRect[], w: number, h: number): RGBA8 {
  const out = new Uint8ClampedArray(w * h * 4);
  images.forEach((img, k) => {
    const r = rects[k];
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4;
        const a = (img.data[s + 3] * masks[k].data[y * img.width + x]) / 255;
        if (!a) continue;
        const o = ((r.y + y) * w + r.x + x) * 4;
        const f = a / 255,
          ab = out[o + 3] / 255;
        const ao = f + ab * (1 - f);
        for (let c = 0; c < 3; c++) out[o + c] = (img.data[s + c] * f + out[o + c] * ab * (1 - f)) / ao;
        out[o + 3] = ao * 255;
      }
  });
  return { width: w, height: h, data: out };
}

/** Context Fill the transparent border of a merged panorama. */
async function fillEdges(img: RGBA8, job: { signal: AbortSignal; progress: (f: number) => void }): Promise<RGBA8> {
  const hole = mask8(img.width, img.height);
  let any = false;
  for (let i = 0; i < hole.data.length; i++)
    if (img.data[i * 4 + 3] < 250) {
      hole.data[i] = 255;
      any = true;
    }
  if (!any) return img;
  const work = copyImage(img);
  const holeCopy = { width: hole.width, height: hole.height, data: new Uint8Array(hole.data) };
  const filled = await channel('heavy').call<RGBA8>('context-fill', { img: work, hole: holeCopy, opts: { seed: 1 } }, { transfer: buffersOf(work, holeCopy), signal: job.signal, progress: (f) => job.progress(0.92 + 0.08 * f) });
  for (let i = 0; i < hole.data.length; i++) filled.data[i * 4 + 3] = 255;
  return filled;
}

// ----- Merge to HDR -----

type HdrOutput = '32' | '8';

export async function mergeHdrDialog(e: Editor) {
  const evs: number[] = [];
  let estimating = 0;
  const d = inputsDialog(
    e,
    'Merge to HDR',
    `<section class="processor-step"><h3><span>2</span>Exposures</h3>
      <p class="comp-note">Relative exposure of each image in stops. Values are estimated from the pixels; adjust them if you know the camera settings.</p>
      <div class="comp-ev-list"></div>
      <label class="dialog-field checkbox-field">Align images<input type="checkbox" name="align" checked></label>
      <label class="dialog-field checkbox-field">Remove ghosts (moving subjects)<input type="checkbox" name="ghosts"></label>
    </section>
    <section class="processor-step"><h3><span>3</span>Result</h3>
      <label class="dialog-field">Output<select name="output"><option value="32">32 bits/channel (HDR)</option><option value="8">8 bits/channel, tone mapped</option></select></label>
      <div class="comp-toning" hidden></div>
    </section>`,
    { submit: 'Merge', max: 7 },
  );
  const list = d.dialog.querySelector<HTMLElement>('.comp-ev-list')!;
  const toning = d.dialog.querySelector<HTMLElement>('.comp-toning')!;
  const tone: HdrToningParams = { ...DEFAULT_HDR_TONING };
  toningControls(toning, tone, () => {});
  const output = field(d.form, 'output');
  output.addEventListener('change', () => (toning.hidden = output.value !== '8'));
  const renderEv = () => {
    const shown = d.inputs.slice(0, 7);
    list.innerHTML = shown.length
      ? shown.map((x, i) => `<label class="comp-ev"><span>${escapeXML(x.name)}</span><input type="number" step="0.1" min="-10" max="10" name="ev${i}" value="${evs[i] ?? 0}" aria-label="Exposure of ${escapeXML(x.name)} (EV)"></label>`).join('')
      : '<p class="muted">Add two to seven bracketed exposures.</p>';
  };
  const estimate = async () => {
    const run = ++estimating;
    const shown = d.inputs.slice(0, 7);
    renderEv();
    if (shown.length < 2) return;
    d.status.textContent = 'Estimating exposures…';
    try {
      const images = await Promise.all(shown.map((x) => loadImage(e, x).then((img) => thumbnail(img, 640))));
      const ev = await runJob<number[]>(undefined, 'hdr-exposures', { images });
      if (run !== estimating) return;
      evs.splice(0, evs.length, ...ev);
      renderEv();
      d.status.textContent = '';
    } catch (error) {
      if (run === estimating) d.status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  let count = -1;
  d.onChange(() => {
    if (d.inputs.length === count) return;
    count = d.inputs.length;
    void estimate();
  });
  if (!(await d.result)) return;
  const shown = d.inputs.slice(0, 7);
  const ev = shown.map((_, i) => Number(field(d.form, `ev${i}`)?.value ?? evs[i] ?? 0) || 0);
  const opts = { align: field(d.form, 'align').checked, ghosts: field(d.form, 'ghosts').checked, output: output.value as HdrOutput, tone: { ...tone } };
  d.close();
  await mergeToHdr(e, shown, ev, opts);
}

function thumbnail(img: RGBA8, max: number): RGBA8 {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  if (k >= 1) return copyImage(img);
  const w = Math.max(1, Math.round(img.width * k)),
    hh = Math.max(1, Math.round(img.height * k));
  const out = new Uint8ClampedArray(w * hh * 4);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) {
      const s = (Math.min(img.height - 1, Math.floor(y / k)) * img.width + Math.min(img.width - 1, Math.floor(x / k))) * 4;
      out.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  return { width: w, height: hh, data: out };
}

export async function mergeToHdr(e: Editor, inputs: Input[], ev: number[], o: { align: boolean; ghosts: boolean; output: HdrOutput; tone: HdrToningParams }) {
  const out = await withTask(e, 'Merging to HDR', async (job) => {
    let images: RGBA8[] = [];
    for (const input of inputs) images.push(await loadImage(e, input));
    const { width, height } = images[0];
    if (images.some((img) => img.width !== width || img.height !== height)) throw new Error('Bracketed exposures must have the same pixel size.');
    job.progress(0.1);
    if (o.align) {
      // Align to the middle exposure in its own frame.
      const order = ev.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const reference = order[(order.length - 1) >> 1][1];
      const r = await runJob<AlignResult>(job, 'align', { images: images.map(copyImage), opts: { projection: 'auto', reference } }, [0.1, 0.4]);
      const rect = { x: 0, y: 0, width, height };
      const moved = images.map((_, i) => i).filter((i) => i !== reference && r.aligned[i]);
      const warped = moved.length ? await runJob<RGBA8[]>(job, 'warp', { items: moved.map((i) => ({ image: copyImage(images[i]), placement: r.placements[i], rect })) }, [0.4, 0.55]) : [];
      images = images.map((img, i) => (moved.includes(i) ? warped[moved.indexOf(i)] : img));
    }
    const merged = await runJob<{ hdr?: RGBAF; toned?: RGBA8 }>(job, 'hdr-merge', { images, ev, removeGhosts: o.ghosts, tone: o.output === '8' ? o.tone : undefined }, [0.55, 1]);
    return { merged, width, height };
  });
  if (!out) return;
  const { merged, width, height } = out;
  const name = `${baseName(inputs[0].name)} HDR`;
  if (merged.toned) {
    await openDocument(e, name, width, height, (doc, s) => [imageLayer(s, doc, 'Background', merged.toned!)]);
    e.message('Merged exposures and tone-mapped the result to 8 bits per channel.');
    return;
  }
  const hdr = merged.hdr!;
  await openDocument(
    e,
    name,
    width,
    height,
    async (_doc, s) => {
      const l = layer('image', 'Background', width, height);
      l.asset = await s.assets.addRaster({ width, height, data: hdr.data as Float32Array<ArrayBuffer> });
      l.assetColorSpace = 'document';
      return [l];
    },
    { bitsPerChannel: 32 },
  );
  e.message('Merged exposures into a 32-bit document. Use Image > Adjustments > HDR Toning to tone-map it.');
}


