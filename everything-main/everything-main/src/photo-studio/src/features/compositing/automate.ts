// File → Automate helpers: Crop and Straighten Photos, Contact Sheet, Fit
// Image, Conditional Mode Change and PDF Presentation, plus Image → Trap.
import type { Editor } from '../../editor';
import type { ColorMode } from '../../model/document';
import { selectionBounds, selectionGrid } from '../../model/selection';
import { layer } from '../../model/document';
import { CancelledError, type RGBA8 } from '../../imaging/types';
import type { FoundPhoto } from '../../imaging/photos/split';
import { fitWithin, sheetCells, sheetPages, type SheetLayout } from '../../imaging/print/layout';
import { writePdf, type PdfPage } from '../../imaging/codecs/pdf';
import { resize } from '../../imaging/filters/resample';
import { defaultCharStyle, defaultParagraphStyle, fromPlainText, type TextLayerData } from '../../imaging/text/model';
import { prepareFonts } from '../../imaging/text/fonts';
import { formDialog } from '../../ui/dialog';
import { download } from '../../persistence/puter';
import { applyToLayer, compositeRGBA, hexRgb } from '../pixels';
import { recordStep } from '../filters/record';
import { runJob, withTask } from './client';
import { baseName, copyImage, field, imageLayer, inputsDialog, loadImage, openDocument } from './sources';

// ----- Crop and Straighten Photos -----

export async function cropAndStraighten(e: Editor) {
  const doc = e.doc;
  const name = doc.name;
  const found = await withTask(e, 'Finding photos', async (job) => {
    let img = await compositeRGBA(e);
    // With a selection, only photos inside it are processed.
    const b = selectionBounds(doc, selectionGrid(doc, e.assets.tiles));
    if (b) img = cropRGBA(img, b);
    const photos = await runJob<FoundPhoto[]>(job, 'find-photos', { image: copyImage(img) }, [0, 0.5]);
    if (!photos.length) return { photos, images: [] as RGBA8[] };
    const images = await runJob<RGBA8[]>(job, 'extract-photos', { image: img, photos }, [0.5, 1]);
    return { photos, images };
  });
  if (!found) return;
  if (!found.images.length) return e.message('No separate photos were found. Scan photos on a plain background with some space between them.');
  for (const [i, img] of found.images.entries())
    await openDocument(e, `${name} copy ${i + 1}`, img.width, img.height, (d, s) => [imageLayer(s, d, 'Background', img)], { resolution: doc.resolution });
  e.message(`Opened ${found.images.length} straightened photo${found.images.length > 1 ? 's' : ''}.`);
}
function cropRGBA(img: RGBA8, r: { x: number; y: number; width: number; height: number }): RGBA8 {
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) out.set(img.data.subarray(((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.width) * 4), y * r.width * 4);
  return { width: r.width, height: r.height, data: out };
}

// ----- Contact Sheet -----

const UNITS: Record<string, number> = { in: 1, cm: 1 / 2.54 };

export async function contactSheetDialog(e: Editor) {
  const d = inputsDialog(
    e,
    'Contact Sheet',
    `<section class="processor-step"><h3><span>2</span>Page</h3>
      <div class="processor-row"><label class="dialog-field">Width<input type="number" name="w" min="1" max="100" step="0.1" value="8.5"></label><label class="dialog-field">Height<input type="number" name="h" min="1" max="100" step="0.1" value="11"></label></div>
      <div class="processor-row"><label class="dialog-field">Units<select name="unit"><option value="in">inches</option><option value="cm">cm</option></select></label><label class="dialog-field">Resolution (ppi)<input type="number" name="ppi" min="36" max="600" value="150"></label></div>
      <div class="processor-row"><label class="dialog-field">Background<select name="bg"><option value="#ffffff">White</option><option value="#1e1e1e">Black</option><option value="#808080">Gray</option></select></label><label class="dialog-field checkbox-field">Flatten all layers<input type="checkbox" name="flatten"></label></div>
    </section>
    <section class="processor-step"><h3><span>3</span>Layout</h3>
      <div class="processor-row"><label class="dialog-field">Columns<input type="number" name="cols" min="1" max="20" value="4"></label><label class="dialog-field">Rows<input type="number" name="rows" min="1" max="20" value="5"></label></div>
      <div class="processor-row"><label class="dialog-field">Spacing (px)<input type="number" name="spacing" min="0" max="500" value="16"></label><label class="dialog-field">Margin (px)<input type="number" name="margin" min="0" max="1000" value="40"></label></div>
      <div class="processor-row"><label class="dialog-field checkbox-field">Use file names as captions<input type="checkbox" name="captions" checked></label><label class="dialog-field">Caption size (pt)<input type="number" name="fontSize" min="4" max="72" value="9"></label></div>
    </section>`,
    { min: 1, submit: 'Create' },
  );
  if (!(await d.result)) return;
  const f = (n: string) => field(d.form, n);
  const ppi = Math.max(36, Math.min(600, Number(f('ppi').value) || 150));
  const u = UNITS[f('unit').value] ?? 1;
  const pageW = Math.round(Number(f('w').value) * u * ppi),
    pageH = Math.round(Number(f('h').value) * u * ppi);
  const captions = f('captions').checked;
  const fontPt = Number(f('fontSize').value) || 9;
  const fontPx = (fontPt * ppi) / 72;
  const layout: SheetLayout = {
    pageWidth: pageW,
    pageHeight: pageH,
    columns: Number(f('cols').value) || 4,
    rows: Number(f('rows').value) || 5,
    margin: Number(f('margin').value) || 0,
    spacing: Number(f('spacing').value) || 0,
    caption: captions ? Math.ceil(fontPx * 1.8) : 0,
  };
  const bg = f('bg').value,
    flatten = f('flatten').checked;
  const inputs = [...d.inputs];
  d.close();
  try {
    if (pageW < 16 || pageH < 16) throw new Error('The page is too small.');
    const { assertSize } = await import('../../model/document');
    assertSize(pageW, pageH);
  } catch (error) {
    return e.message(error instanceof Error ? error.message : String(error));
  }
  // Load and shrink each image to its cell as it arrives (keeps memory low).
  const pages = sheetPages(layout, inputs.length);
  const result = await withTask(e, 'Creating contact sheet', async (job) => {
    const thumbs: { name: string; image: RGBA8 }[] = [];
    const sizes: { width: number; height: number }[] = [];
    for (const [i, input] of inputs.entries()) {
      if (job.signal.aborted) break;
      try {
        const img = await loadImage(e, input);
        sizes.push({ width: img.width, height: img.height });
        const cell = sheetCells(layout, [...sizes], false)[sizes.length - 1];
        const w = Math.max(1, Math.round(cell.image.width)),
          h = Math.max(1, Math.round(cell.image.height));
        thumbs.push({ name: baseName(input.name), image: w < img.width ? resize(img, w, h, 'bicubic-sharper') : img });
      } catch (error) {
        e.message(`${input.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      job.progress((i + 1) / inputs.length);
    }
    return { thumbs, cells: sheetCells(layout, sizes, false) };
  });
  if (!result) return;
  // Type sizes are points at the document resolution.
  const style = { ...defaultCharStyle(), size: fontPt, color: (bg === '#ffffff' ? [40, 40, 40] : [235, 235, 235]) as [number, number, number] };
  for (let page = 0; page < pages; page++) {
    const entries = result.cells.map((c, i) => ({ c, t: result.thumbs[i] })).filter((x) => x.c.page === page && x.t);
    if (!entries.length) continue;
    await openDocument(e, pages > 1 ? `Contact Sheet ${page + 1}` : 'Contact Sheet', pageW, pageH, async (doc, s) => {
      const fill = new Uint8ClampedArray(pageW * pageH * 4);
      const rgb = hexRgb(bg);
      for (let i = 0; i < fill.length; i += 4) fill.set([rgb[0], rgb[1], rgb[2], 255], i);
      const layers = [imageLayer(s, doc, 'Background', { width: pageW, height: pageH, data: fill })];
      for (const { c, t } of entries) {
        const x = Math.round(c.image.x),
          y = Math.round(c.image.y);
        if (flatten) blit(fill, pageW, t.image, x, y);
        else layers.push(imageLayer(s, doc, t.name, t.image, x, y));
        if (c.caption) {
          const data: TextLayerData = {
            content: fromPlainText(t.name, style, { ...defaultParagraphStyle(), align: 'center' }),
            mode: 'paragraph',
            box: { width: c.caption.width, height: c.caption.height },
            origin: { x: c.caption.x, y: c.caption.y },
            orientation: 'horizontal',
            antiAlias: 'sharp',
          };
          await prepareFonts(data);
          const l = layer('text', t.name, c.caption.width, c.caption.height);
          l.textData = data;
          l.text = t.name;
          l.textFrame = { x: data.origin.x, y: data.origin.y, ...data.box! };
          l.transform = { ...l.textFrame, rotation: 0 };
          layers.push(l);
        }
      }
      if (flatten) layers[0] = imageLayer(s, doc, 'Background', { width: pageW, height: pageH, data: fill });
      return layers;
    }, { resolution: { horizontalResolution: ppi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: ppi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } });
  }
  e.message(`Created ${pages} contact sheet page${pages > 1 ? 's' : ''}.`);
}
function blit(dst: Uint8ClampedArray, dw: number, src: RGBA8, x: number, y: number) {
  const dh = dst.length / 4 / dw;
  for (let j = 0; j < src.height; j++) {
    const yy = y + j;
    if (yy < 0 || yy >= dh) continue;
    for (let i = 0; i < src.width; i++) {
      const xx = x + i;
      if (xx < 0 || xx >= dw) continue;
      const s = (j * src.width + i) * 4,
        o = (yy * dw + xx) * 4;
      const a = src.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) dst[o + c] = src.data[s + c] * a + dst[o + c] * (1 - a);
    }
  }
}

// ----- Fit Image -----

type FitParams = { width: number; height: number; enlarge: boolean };
export async function fitImage(e: Editor, arg?: unknown) {
  let p = (arg as { params?: FitParams } | undefined)?.params;
  if (!p) {
    const v = await formDialog(
      'Fit Image',
      [
        { name: 'width', label: 'Width (px)', value: e.doc.width, type: 'number', min: 1, max: 8192, step: 1 },
        { name: 'height', label: 'Height (px)', value: e.doc.height, type: 'number', min: 1, max: 8192, step: 1 },
        { name: 'enlarge', label: 'Do not enlarge', value: 'yes', type: 'checkbox' },
      ],
      'OK',
      'Resizes the image to fit inside these dimensions, keeping its proportions.',
    );
    if (!v) return;
    p = { width: Math.round(Number(v.width)), height: Math.round(Number(v.height)), enlarge: v.enlarge !== 'yes' };
    recordStep(e, 'file.fit-image', { params: p });
  }
  const [w, h] = fitWithin(e.doc.width, e.doc.height, p.width, p.height, p.enlarge);
  if (w === e.doc.width && h === e.doc.height) return e.message('The image already fits.');
  const { resampleDocument } = await import('../transform/image-size');
  resampleDocument(e, w, h, w < e.doc.width ? 'bicubic-sharper' : 'bicubic-smoother');
  e.fit();
  e.message(`Resized to ${w} × ${h} px.`);
}

// ----- Conditional Mode Change -----

const MODES: ColorMode[] = ['bitmap', 'grayscale', 'duotone', 'indexed', 'rgb', 'cmyk', 'lab'];
type ConditionalParams = { from: ColorMode[]; to: ColorMode };
export async function conditionalModeChange(e: Editor, arg?: unknown) {
  const { MODE_NAMES, convertToMode } = await import('../color/modes');
  let p = (arg as { params?: ConditionalParams } | undefined)?.params;
  if (!p) {
    const v = await formDialog(
      'Conditional Mode Change',
      [
        ...MODES.map((m) => ({ name: `from-${m}`, label: `From ${MODE_NAMES[m]}`, value: m === 'rgb' || m === 'lab' || m === 'cmyk' ? 'yes' : 'no', type: 'checkbox' })),
        { name: 'to', label: 'Convert to', value: 'rgb', type: 'select', options: (['rgb', 'cmyk', 'lab', 'grayscale', 'indexed', 'bitmap', 'duotone'] as ColorMode[]).map((m) => [m, MODE_NAMES[m]] as [string, string]) },
      ],
      'OK',
      'Converts the document only when its current mode is one of the checked modes; useful in recorded actions.',
    );
    if (!v) return;
    p = { from: MODES.filter((m) => v[`from-${m}`] === 'yes'), to: v.to as ColorMode };
    recordStep(e, 'file.conditional-mode', { params: p });
  }
  const mode = e.doc.mode ?? 'rgb';
  if (!p.from.includes(mode)) return e.message(`The document is ${MODE_NAMES[mode]}, which is not a selected source mode; nothing changed.`);
  if (mode === p.to) return e.message(`The document is already ${MODE_NAMES[mode]}.`);
  await convertToMode(e, p.to);
}

// ----- PDF Presentation -----

const PAGE_SIZES: Record<string, [number, number] | null> = { fit: null, letter: [612, 792], a4: [595.28, 841.89], 'letter-l': [792, 612], 'a4-l': [841.89, 595.28] };

export async function pdfPresentationDialog(e: Editor) {
  const d = inputsDialog(
    e,
    'PDF Presentation',
    `<section class="processor-step"><h3><span>2</span>Pages</h3>
      <div class="processor-row"><label class="dialog-field">Page size<select name="page"><option value="fit">Fit each image</option><option value="letter">Letter</option><option value="letter-l">Letter (landscape)</option><option value="a4">A4</option><option value="a4-l">A4 (landscape)</option></select></label><label class="dialog-field">Background<select name="bg"><option value="#ffffff">White</option><option value="#000000">Black</option><option value="#808080">Gray</option></select></label></div>
      <div class="processor-row"><label class="dialog-field">Image resolution (ppi)<input type="number" name="ppi" min="36" max="600" value="150"></label><label class="dialog-field">JPEG quality<input type="number" name="quality" min="10" max="100" value="85"></label></div>
      <label class="dialog-field checkbox-field">Show file names<input type="checkbox" name="names"></label>
      <label class="dialog-field">File name<input type="text" name="file" value="Presentation.pdf"></label>
    </section>`,
    { min: 1, submit: 'Save PDF' },
  );
  if (!(await d.result)) return;
  const f = (n: string) => field(d.form, n);
  const size = PAGE_SIZES[f('page').value] ?? null;
  const bg = hexRgb(f('bg').value);
  const ppi = Math.max(36, Math.min(600, Number(f('ppi').value) || 150));
  const quality = Math.max(10, Math.min(100, Number(f('quality').value) || 85)) / 100;
  const names = f('names').checked;
  let fileName = f('file').value.trim() || 'Presentation.pdf';
  if (!/\.pdf$/i.test(fileName)) fileName += '.pdf';
  const inputs = [...d.inputs];
  d.close();
  const pages = await withTask(e, 'Creating PDF', async (job) => {
    const out: PdfPage[] = [];
    for (const [i, input] of inputs.entries()) {
      if (job.signal.aborted) break;
      const img = await loadImage(e, input);
      const caption = names ? 24 : 0;
      // Page in points: the image at its print size, or fitted to the page.
      const natural = [(img.width * 72) / ppi, (img.height * 72) / ppi];
      const [pw, ph] = size ?? [natural[0] + 72, natural[1] + 72 + caption];
      const s = Math.min(1, (pw - 72) / natural[0], (ph - 72 - caption) / natural[1]);
      const w = natural[0] * s,
        h = natural[1] * s;
      // Downsample to the output resolution before encoding.
      const px = fitWithin(img.width, img.height, Math.max(1, Math.round((w * ppi) / 72)), Math.max(1, Math.round((h * ppi) / 72)), false);
      const small = px[0] < img.width ? resize(img, px[0], px[1], 'bicubic-sharper') : img;
      const jpeg = await encodeJpeg(small, quality, bg);
      out.push({
        width: pw,
        height: ph,
        background: bg,
        images: [{ x: (pw - w) / 2, y: (ph - caption - h) / 2, width: w, height: h, image: { kind: 'jpeg', bytes: jpeg, width: small.width, height: small.height } }],
        texts: names ? [{ x: pw / 2, y: ph - 24, size: 10, text: input.name, align: 'center', color: bg[0] + bg[1] + bg[2] > 380 ? [40, 40, 40] : [230, 230, 230] }] : [],
      });
      job.progress((i + 1) / inputs.length);
    }
    return out;
  });
  if (!pages?.length) return;
  const bytes = writePdf(pages, { title: fileName.replace(/\.pdf$/i, '') });
  download(new Blob([bytes.slice().buffer], { type: 'application/pdf' }), fileName);
  e.message(`Saved ${pages.length} page${pages.length > 1 ? 's' : ''} to ${fileName}.`);
}

async function encodeJpeg(img: RGBA8, quality: number, matte: [number, number, number]): Promise<Uint8Array> {
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${matte.join(',')})`;
  g.fillRect(0, 0, img.width, img.height);
  const tmp = new OffscreenCanvas(img.width, img.height);
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  g.drawImage(tmp, 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
}

// ----- Trap -----

export async function trapCommand(e: Editor, arg?: unknown) {
  let width = (arg as { params?: { width?: number } } | undefined)?.params?.width;
  if (!width) {
    const v = await formDialog('Trap', [{ name: 'width', label: 'Width (px)', value: 2, type: 'number', min: 1, max: 10, step: 1 }], 'OK', 'Spreads lighter colors under neighbouring darker ones so small press misregistration does not leave gaps.');
    if (!v) return;
    width = Math.max(1, Math.min(10, Math.round(Number(v.width)) || 1));
    recordStep(e, 'image.trap', { params: { width } });
  }
  await applyToLayer(e, 'Trap', async (src) => {
    const out = await withTask(e, 'Trapping', (job) => runJob<RGBA8>(job, 'trap', { image: copyImage(src), width }));
    if (!out) throw new CancelledError();
    return out;
  });
}

